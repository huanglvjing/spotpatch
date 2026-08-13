import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  DATA_FLOW_SCHEMA_VERSION,
  DATA_FLOW_QUERY_ADAPTER_MODULES,
  DEFAULT_DATA_FLOW_LIMITS,
  isSensitiveName,
  type ComponentDataFlowReport,
  type DataDependency,
  type DataFlowDiagnostic,
  type DataFlowDiagnosticCode,
  type DataFlowLimits,
  type DataParameter,
  type EvidenceRef,
  type EvidenceSourceRef,
} from "@spotpatch/shared";
import {
  createDataFlowAnchorId as createAnalyzerId,
  createDataFlowSourceVersion as createSourceVersion,
} from "@spotpatch/compiler";
import ts from "typescript";

import { extractRequest } from "./request-extractor.js";
import {
  functionName,
  isFunctionImplementation,
  isInsideRoot,
  isSameFilePath,
  propertyNameText,
  resolveAliasedSymbol,
  toDisplayPath,
  visitFunctionBody,
  type FunctionImplementation,
} from "./typescript-utils.js";

const ANALYZER_VERSION = "0.0.2";
const REACT_EFFECT_NAMES = new Set(["useEffect", "useLayoutEffect"]);
const CALLBACK_CALL_NAMES = new Set([
  "setInterval",
  "setTimeout",
  "then",
  "catch",
  "finally",
]);
const REACT_QUERY_MODULES = new Set<string>(DATA_FLOW_QUERY_ADAPTER_MODULES);

export interface AnalyzeComponentInput {
  readonly absolutePath: string;
  readonly line: number;
  readonly column: number;
  readonly signal?: AbortSignal;
}

export interface StaticDataFlowAnalyzerOptions {
  readonly root: string;
  readonly registryEpoch: string;
  readonly registerSource: (absolutePath: string) => string;
  readonly limits?: DataFlowLimits;
}

export interface StaticDataFlowAnalyzer {
  readonly analyzeComponent: (input: AnalyzeComponentInput) => ComponentDataFlowReport;
  readonly invalidate: () => void;
}

interface ProgramCacheEntry {
  readonly entryVersion: string;
  readonly program: ts.Program;
  readonly sourceVersions: ReadonlyMap<string, string>;
}

interface TriggerRoot {
  readonly depth: number;
  readonly functionNode: FunctionImplementation;
  readonly triggerId: string;
}

interface TraceEntry {
  readonly depth: number;
  readonly functionNode: FunctionImplementation;
  readonly triggerId: string;
}

class AnalysisStopped extends Error {
  readonly reason: "timeout" | "callsites" | "modules" | "depth" | "cancelled";

  constructor(reason: AnalysisStopped["reason"]) {
    super(`Static data-flow analysis stopped: ${reason}`);
    this.name = "AnalysisStopped";
    this.reason = reason;
  }
}

function readCompilerOptions(root: string, absolutePath: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(
    root,
    (fileName) => ts.sys.fileExists(fileName),
    "tsconfig.json",
  );
  if (configPath === undefined) {
    return {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
    };
  }

  const visited = new Set<string>();

  function parseConfig(candidatePath: string): ts.ParsedCommandLine {
    const normalized = path.resolve(candidatePath);
    if (visited.has(normalized)) {
      throw new TypeError("SpotPatch found a cyclic TypeScript project reference.");
    }
    visited.add(normalized);
    const read = ts.readConfigFile(normalized, (fileName) => ts.sys.readFile(fileName));
    if (read.error !== undefined) {
      throw new TypeError("SpotPatch could not read the project TypeScript config.");
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(normalized),
      undefined,
      normalized,
    );

    if (parsed.fileNames.some((fileName) => isSameFilePath(fileName, absolutePath))) {
      return parsed;
    }

    for (const reference of parsed.projectReferences ?? []) {
      const referencePath = ts.resolveProjectReferencePath(reference);
      const referenced = parseConfig(referencePath);
      if (
        referenced.fileNames.some((fileName) => isSameFilePath(fileName, absolutePath))
      ) {
        return referenced;
      }
    }

    return parsed;
  }

  const parsed = parseConfig(configPath);
  return Object.freeze({
    ...parsed.options,
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
  });
}

function createProgram(
  absolutePath: string,
  compilerOptions: ts.CompilerOptions,
): ts.Program {
  return ts.createProgram({ rootNames: [absolutePath], options: compilerOptions });
}

function isUppercaseComponentName(name: string | undefined): name is string {
  return name !== undefined && /^[A-Z]/u.test(name);
}

function findSelectedComponent(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  line: number,
  column: number,
): FunctionImplementation | undefined {
  const safeLine = Math.min(
    Math.max(line - 1, 0),
    sourceFile.getLineStarts().length - 1,
  );
  const lineStart = sourceFile.getPositionOfLineAndCharacter(safeLine, 0);
  const position = Math.min(lineStart + Math.max(column - 1, 0), sourceFile.end);
  let selected: FunctionImplementation | undefined;

  function unwrapComponent(
    initializer: ts.Expression,
  ): FunctionImplementation | undefined {
    if (isFunctionImplementation(initializer)) return initializer;
    if (!ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) {
      return undefined;
    }
    const symbol = checker.getSymbolAtLocation(initializer.expression);
    const imported = symbol?.declarations?.find(ts.isImportSpecifier);
    if (imported === undefined) return undefined;
    const declaration = imported.parent.parent.parent;
    if (
      !ts.isImportDeclaration(declaration) ||
      !ts.isStringLiteral(declaration.moduleSpecifier) ||
      declaration.moduleSpecifier.text !== "react"
    ) {
      return undefined;
    }
    const importedName = imported.propertyName?.text ?? imported.name.text;
    if (importedName !== "memo" && importedName !== "forwardRef") return undefined;
    const callback = initializer.arguments[0];
    return callback !== undefined && isFunctionImplementation(callback)
      ? callback
      : undefined;
  }

  function consider(candidate: FunctionImplementation, range: ts.Node): void {
    const candidateLine = sourceFile.getLineAndCharacterOfPosition(
      range.getStart(sourceFile),
    ).line;
    const matches =
      (range.pos <= position && range.end >= position) || candidateLine === safeLine;

    if (
      matches &&
      (selected === undefined ||
        candidate.end - candidate.pos < selected.end - selected.pos)
    ) {
      selected = candidate;
    }
  }

  function visit(node: ts.Node): void {
    if (
      isFunctionImplementation(node) &&
      isUppercaseComponentName(functionName(node))
    ) {
      consider(node, node);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isUppercaseComponentName(node.name.text) &&
      node.initializer !== undefined
    ) {
      const implementation = unwrapComponent(node.initializer);
      if (implementation?.body !== undefined) consider(implementation, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return selected;
}

function selectedComponentName(component: FunctionImplementation): string | undefined {
  const direct = functionName(component);
  if (direct !== undefined) return direct;
  const parent = component.parent;
  return ts.isCallExpression(parent) &&
    ts.isVariableDeclaration(parent.parent) &&
    ts.isIdentifier(parent.parent.name)
    ? parent.parent.name.text
    : undefined;
}

function functionFromDeclaration(
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
  root: string,
): FunctionImplementation | undefined {
  if (isFunctionImplementation(declaration) && declaration.body !== undefined) {
    return declaration;
  }

  if (ts.isVariableDeclaration(declaration)) {
    const initializer = declaration.initializer;
    if (initializer === undefined) return undefined;
    if (isFunctionImplementation(initializer)) return initializer;
    if (
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      (initializer.expression.text === "useCallback" ||
        initializer.expression.text === "useMemo")
    ) {
      const callback = initializer.arguments[0];
      return callback !== undefined && isFunctionImplementation(callback)
        ? callback
        : undefined;
    }
    return undefined;
  }

  if (ts.isPropertyAssignment(declaration)) {
    return isFunctionImplementation(declaration.initializer)
      ? declaration.initializer
      : undefined;
  }

  if (ts.isBindingElement(declaration)) {
    return resolveZustandBinding(checker, declaration, root);
  }

  return undefined;
}

function findFunctionProperty(
  initializer: ts.Expression,
  propertyName: string,
): readonly FunctionImplementation[] {
  const matches: FunctionImplementation[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isMethodDeclaration(node) &&
      propertyNameText(node.name) === propertyName &&
      node.body !== undefined
    ) {
      matches.push(node);
      return;
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name) === propertyName &&
      isFunctionImplementation(node.initializer)
    ) {
      matches.push(node.initializer);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(initializer);
  return Object.freeze(matches);
}

function resolveZustandBinding(
  checker: ts.TypeChecker,
  binding: ts.BindingElement,
  root: string,
): FunctionImplementation | undefined {
  const bindingName = propertyNameText(binding.propertyName ?? binding.name);
  if (bindingName === undefined) return undefined;
  const pattern = binding.parent;
  const declaration = pattern.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
    return undefined;
  }

  const initializer = declaration.initializer;
  if (!ts.isCallExpression(initializer)) return undefined;
  const storeSymbol = checker.getSymbolAtLocation(initializer.expression);
  if (storeSymbol === undefined) return undefined;
  const resolvedStore = resolveAliasedSymbol(checker, storeSymbol);

  for (const storeDeclaration of resolvedStore.declarations ?? []) {
    if (
      !isInsideRoot(root, storeDeclaration.getSourceFile().fileName) ||
      !ts.isVariableDeclaration(storeDeclaration) ||
      storeDeclaration.initializer === undefined
    ) {
      continue;
    }
    const matches = findFunctionProperty(storeDeclaration.initializer, bindingName);
    if (matches.length === 1) return matches[0];
  }

  return undefined;
}

function resolveFunctionExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  root: string,
): FunctionImplementation | undefined {
  if (isFunctionImplementation(expression)) {
    return expression;
  }

  const symbol = checker.getSymbolAtLocation(expression);
  if (symbol === undefined) return undefined;
  const resolved = resolveAliasedSymbol(checker, symbol);
  const matches = (resolved.declarations ?? [])
    .map((declaration) => functionFromDeclaration(checker, declaration, root))
    .filter((value): value is FunctionImplementation => value !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

function jsxAttributeName(attribute: ts.JsxAttribute): string {
  return attribute.name.getText(attribute.getSourceFile());
}

function importForIdentifier(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): Readonly<{ importedName: string; moduleName: string }> | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  const declaration = symbol?.declarations?.find(ts.isImportSpecifier);
  if (declaration === undefined) return undefined;
  const importDeclaration = declaration.parent.parent.parent;
  if (
    !ts.isImportDeclaration(importDeclaration) ||
    !ts.isStringLiteral(importDeclaration.moduleSpecifier)
  ) {
    return undefined;
  }
  return Object.freeze({
    importedName: declaration.propertyName?.text ?? declaration.name.text,
    moduleName: importDeclaration.moduleSpecifier.text,
  });
}

function objectCallbackProperty(
  expression: ts.Expression | undefined,
  propertyKey: string,
): ts.Expression | undefined {
  if (expression === undefined || !ts.isObjectLiteralExpression(expression)) {
    return undefined;
  }
  const property = expression.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      propertyNameText(candidate.name) === propertyKey,
  );
  return property?.initializer;
}

function reactQueryCallback(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): ts.Expression | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const imported = importForIdentifier(checker, call.expression);
  if (
    imported === undefined ||
    !REACT_QUERY_MODULES.has(imported.moduleName) ||
    (imported.importedName !== "useQuery" &&
      imported.importedName !== "useInfiniteQuery" &&
      imported.importedName !== "useMutation")
  ) {
    return undefined;
  }
  if (imported.importedName === "useMutation") {
    return objectCallbackProperty(call.arguments[0], "mutationFn") ?? call.arguments[0];
  }
  return objectCallbackProperty(call.arguments[0], "queryFn") ?? call.arguments[1];
}

function collectTriggerRoots(
  checker: ts.TypeChecker,
  component: FunctionImplementation,
  componentId: string,
  sourceVersion: string,
  relativePath: string,
  root: string,
): readonly TriggerRoot[] {
  const triggers: TriggerRoot[] = [
    Object.freeze({
      depth: 0,
      functionNode: component,
      triggerId: createAnalyzerId(
        "trigger",
        relativePath,
        sourceVersion,
        component.getStart(),
        "render",
      ),
    }),
  ];
  const body = component.body;
  if (body === undefined) return triggers;

  function addTrigger(functionNode: FunctionImplementation, node: ts.Node): void {
    const triggerId = createAnalyzerId(
      "trigger",
      relativePath,
      sourceVersion,
      node.getStart(),
      componentId,
    );
    if (!triggers.some((trigger) => trigger.triggerId === triggerId)) {
      const componentFile = component.getSourceFile();
      const handlerFile = functionNode.getSourceFile();
      const insideComponent =
        componentFile === handlerFile &&
        functionNode.pos >= component.pos &&
        functionNode.end <= component.end;
      triggers.push(
        Object.freeze({
          depth: insideComponent ? 0 : 1,
          functionNode,
          triggerId,
        }),
      );
    }
  }

  function visit(node: ts.Node): void {
    if (node !== body && isFunctionImplementation(node)) return;

    if (
      ts.isJsxAttribute(node) &&
      /^on[A-Z]/u.test(jsxAttributeName(node)) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined
    ) {
      const handler = resolveFunctionExpression(
        checker,
        node.initializer.expression,
        root,
      );
      if (handler !== undefined) addTrigger(handler, node);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      REACT_EFFECT_NAMES.has(node.expression.text)
    ) {
      const callback = node.arguments[0];
      if (callback !== undefined) {
        const handler = resolveFunctionExpression(checker, callback, root);
        if (handler !== undefined) addTrigger(handler, node);
      }
    }

    if (ts.isCallExpression(node)) {
      const callback = reactQueryCallback(checker, node);
      if (callback !== undefined) {
        const handler = resolveFunctionExpression(checker, callback, root);
        if (handler !== undefined) addTrigger(handler, node);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(body);
  return Object.freeze(triggers);
}

function nearestFunction(node: ts.Node): FunctionImplementation | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isFunctionImplementation(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : undefined;
}

function propertyPath(expression: ts.Expression): readonly string[] {
  const parts: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  return Object.freeze(parts);
}

function requestResultBinding(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): Readonly<{ owner: FunctionImplementation; symbol: ts.Symbol }> | undefined {
  let assignment: ts.Node = call;
  while (
    ts.isAwaitExpression(assignment.parent) ||
    ts.isParenthesizedExpression(assignment.parent) ||
    ts.isAsExpression(assignment.parent)
  ) {
    assignment = assignment.parent;
  }
  const declaration = assignment.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
    return undefined;
  }
  const resultSymbol = checker.getSymbolAtLocation(declaration.name);
  const owner = nearestFunction(declaration);
  return resultSymbol === undefined || owner === undefined
    ? undefined
    : Object.freeze({ owner, symbol: resultSymbol });
}

function collectConsumedFields(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): readonly string[] {
  const result = requestResultBinding(checker, call);
  if (result === undefined) return Object.freeze([]);
  const resultSymbol = result.symbol;
  const owner = result.owner;
  const fields = new Set<string>();
  const bindingPrefixes = new Map<ts.Symbol, string>();

  function referencesResult(node: ts.Node): boolean {
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === resultSymbol) {
      return true;
    }
    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && referencesResult(child)) found = true;
    });
    return found;
  }

  visitFunctionBody(owner, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      referencesResult(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const name = propertyNameText(element.propertyName ?? element.name);
        if (name === undefined || !ts.isIdentifier(element.name)) continue;
        const symbol = checker.getSymbolAtLocation(element.name);
        if (symbol !== undefined) bindingPrefixes.set(symbol, name);
        fields.add(name);
      }
    }

    if (!ts.isPropertyAccessExpression(node)) return;
    const root = rootIdentifier(node);
    if (root === undefined) return;
    const rootSymbol = checker.getSymbolAtLocation(root);
    const parts = propertyPath(node);
    if (rootSymbol === resultSymbol && parts.length > 0) {
      fields.add(parts.join("."));
      return;
    }
    const prefix =
      rootSymbol === undefined ? undefined : bindingPrefixes.get(rootSymbol);
    if (prefix !== undefined && parts.length > 0) {
      fields.add([prefix, ...parts].join("."));
    }
  });

  return Object.freeze([...fields].sort());
}

function collectBindingSymbols(
  checker: ts.TypeChecker,
  name: ts.BindingName,
): readonly ts.Symbol[] {
  const symbols: ts.Symbol[] = [];
  function visit(binding: ts.BindingName): void {
    if (ts.isIdentifier(binding)) {
      const symbol = checker.getSymbolAtLocation(binding);
      if (symbol !== undefined) symbols.push(symbol);
      return;
    }
    for (const element of binding.elements) {
      if (!ts.isOmittedExpression(element)) visit(element.name);
    }
  }
  visit(name);
  return Object.freeze(symbols);
}

function collectSuppliedBindings(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  root: string,
): readonly string[] {
  const result = requestResultBinding(checker, call);
  if (result === undefined) return Object.freeze([]);
  const tainted = new Set<ts.Symbol>([result.symbol]);
  const supplied = new Set<string>();

  function referencesTainted(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && tainted.has(symbol)) return true;
    }
    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && referencesTainted(child)) found = true;
    });
    return found;
  }

  function reactStateBinding(expression: ts.Expression): string | undefined {
    if (!ts.isIdentifier(expression)) return undefined;
    const symbol = checker.getSymbolAtLocation(expression);
    const declaration = symbol?.declarations?.find(ts.isBindingElement);
    if (declaration === undefined || !ts.isArrayBindingPattern(declaration.parent)) {
      return undefined;
    }
    const variable = declaration.parent.parent;
    if (
      !ts.isVariableDeclaration(variable) ||
      variable.initializer === undefined ||
      !ts.isCallExpression(variable.initializer) ||
      !ts.isIdentifier(variable.initializer.expression) ||
      variable.initializer.expression.text !== "useState"
    ) {
      return undefined;
    }
    const state = declaration.parent.elements[0];
    return state !== undefined &&
      !ts.isOmittedExpression(state) &&
      ts.isIdentifier(state.name)
      ? state.name.text
      : undefined;
  }

  function storeBinding(expression: ts.Expression): ts.BindingElement | undefined {
    if (!ts.isIdentifier(expression)) return undefined;
    const symbol = checker.getSymbolAtLocation(expression);
    const declaration = symbol?.declarations?.find(ts.isBindingElement);
    return declaration !== undefined &&
      resolveZustandBinding(checker, declaration, root) !== undefined
      ? declaration
      : undefined;
  }

  let changed = true;
  while (changed) {
    changed = false;
    visitFunctionBody(result.owner, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        referencesTainted(node.initializer)
      ) {
        for (const symbol of collectBindingSymbols(checker, node.name)) {
          if (!tainted.has(symbol)) {
            tainted.add(symbol);
            changed = true;
          }
        }
      }
    });
  }

  visitFunctionBody(result.owner, (node) => {
    if (!ts.isCallExpression(node) || node === call) return;
    const taintedArguments = node.arguments.filter(referencesTainted);
    if (taintedArguments.length === 0) return;

    const state = reactStateBinding(node.expression);
    if (state !== undefined) supplied.add(`react-state:${state}`);

    const store = storeBinding(node.expression);
    const field = node.arguments[0];
    if (store !== undefined && field !== undefined && ts.isStringLiteral(field)) {
      supplied.add(`zustand:${field.text}`);
    }

    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setItem" &&
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.expression.text === "localStorage" ||
        node.expression.expression.text === "sessionStorage")
    ) {
      const key = node.arguments[0];
      if (key !== undefined && ts.isStringLiteral(key)) {
        supplied.add(`${node.expression.expression.text}:${key.text}`);
      }
    }

    if (ts.isIdentifier(node.expression)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      const fromComponentProperty = symbol?.declarations?.some(
        (declaration) =>
          ts.isBindingElement(declaration) && ts.isParameter(declaration.parent.parent),
      );
      if (fromComponentProperty === true) {
        supplied.add(`callback-prop:${node.expression.text}`);
      }
    }
  });

  return Object.freeze([...supplied].sort());
}

function sourceRef(
  root: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  sourceVersion: string,
  registerSource: (absolutePath: string) => string,
): EvidenceSourceRef {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return Object.freeze({
    fileId: registerSource(sourceFile.fileName),
    displayPath: toDisplayPath(root, sourceFile.fileName),
    line: position.line + 1,
    column: position.character + 1,
    sourceVersion,
  });
}

function diagnostic(
  id: string,
  code: DataFlowDiagnosticCode,
  severity: DataFlowDiagnostic["severity"],
): DataFlowDiagnostic {
  return Object.freeze({
    id,
    code,
    severity,
    retryable: code === "DATA_FLOW_ANALYSIS_TIMEOUT",
    evidenceIds: Object.freeze([]),
  });
}

export function createStaticDataFlowAnalyzer(
  options: StaticDataFlowAnalyzerOptions,
): StaticDataFlowAnalyzer {
  const root = realpathSync.native(path.resolve(options.root));
  const limits = options.limits ?? DEFAULT_DATA_FLOW_LIMITS;
  const compilerOptionsByEntry = new Map<string, ts.CompilerOptions>();
  const programCache = new Map<string, ProgramCacheEntry>();

  function programSourceVersions(program: ts.Program): ReadonlyMap<string, string> {
    return new Map(
      program
        .getSourceFiles()
        .filter(
          (sourceFile) =>
            !sourceFile.isDeclarationFile &&
            isInsideRoot(root, path.resolve(sourceFile.fileName)),
        )
        .map((sourceFile) => [
          path.resolve(sourceFile.fileName),
          createSourceVersion(sourceFile.text),
        ]),
    );
  }

  function cacheIsCurrent(cached: ProgramCacheEntry): boolean {
    try {
      for (const [fileName, version] of cached.sourceVersions) {
        if (createSourceVersion(readFileSync(fileName, "utf8")) !== version) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function getProgram(absolutePath: string, code: string): ts.Program {
    const entryVersion = createSourceVersion(code);
    const cached = programCache.get(absolutePath);
    if (cached?.entryVersion === entryVersion && cacheIsCurrent(cached)) {
      return cached.program;
    }
    const compilerOptions =
      compilerOptionsByEntry.get(absolutePath) ??
      readCompilerOptions(root, absolutePath);
    compilerOptionsByEntry.set(absolutePath, compilerOptions);
    const program = createProgram(absolutePath, compilerOptions);
    programCache.set(
      absolutePath,
      Object.freeze({
        entryVersion,
        program,
        sourceVersions: programSourceVersions(program),
      }),
    );
    return program;
  }

  function analyzeComponent(input: AnalyzeComponentInput): ComponentDataFlowReport {
    const absolutePath = realpathSync.native(path.resolve(input.absolutePath));
    if (!isInsideRoot(root, absolutePath)) {
      throw new RangeError("SpotPatch data-flow source is outside the project root.");
    }
    const code = readFileSync(absolutePath, "utf8");
    const sourceVersion = createSourceVersion(code);
    const relativePath = toDisplayPath(root, absolutePath);
    const reportId = createAnalyzerId(
      "report",
      relativePath,
      sourceVersion,
      input.line,
      String(input.column),
    );
    const program = getProgram(absolutePath, code);
    const checker = program.getTypeChecker();
    const sourceFile =
      program.getSourceFile(absolutePath) ??
      program
        .getSourceFiles()
        .find((candidate) => isSameFilePath(candidate.fileName, absolutePath));
    if (sourceFile === undefined) {
      throw new TypeError("SpotPatch data-flow source could not be parsed.");
    }
    const component = findSelectedComponent(
      checker,
      sourceFile,
      input.line,
      input.column,
    );
    if (component === undefined) {
      const source = sourceRef(
        root,
        sourceFile,
        sourceFile,
        sourceVersion,
        options.registerSource,
      );
      return Object.freeze({
        schemaVersion: DATA_FLOW_SCHEMA_VERSION,
        reportId,
        baseline: Object.freeze({
          registryEpoch: options.registryEpoch,
          analyzerVersion: ANALYZER_VERSION,
          adapterSetHash: "builtin-v2",
          analyzedSourceVersions: Object.freeze([sourceVersion]),
        }),
        capability: Object.freeze({
          enabled: true,
          staticAnalysis: "unavailable",
          runtimeObservation: "dispatch-only",
          responseShape: "consumed-fields-only",
          aiAssistance: "disabled",
          reasons: Object.freeze([
            Object.freeze({
              code: "DATA_FLOW_SOURCE_UNAVAILABLE",
              retryable: false,
            }),
          ]),
        }),
        component: Object.freeze({ source }),
        dependencies: Object.freeze([]),
        evidence: Object.freeze([]),
        diagnostics: Object.freeze([
          diagnostic(`${reportId}_source`, "DATA_FLOW_SOURCE_UNAVAILABLE", "warning"),
        ]),
        completeness: Object.freeze({
          complete: false,
          visitedModules: 1,
          visitedCallsites: 0,
          frontierCount: 1,
        }),
      });
    }

    const componentName = selectedComponentName(component);
    const componentId = createAnalyzerId(
      "component",
      relativePath,
      sourceVersion,
      component.getStart(sourceFile),
    );
    const componentSource = sourceRef(
      root,
      sourceFile,
      component,
      sourceVersion,
      options.registerSource,
    );
    const triggerRoots = collectTriggerRoots(
      checker,
      component,
      componentId,
      sourceVersion,
      relativePath,
      root,
    );
    const dependencies: DataDependency[] = [];
    const evidence: EvidenceRef[] = [];
    const diagnostics: DataFlowDiagnostic[] = [];
    const queue: TraceEntry[] = triggerRoots.map((trigger) =>
      Object.freeze({
        depth: trigger.depth,
        functionNode: trigger.functionNode,
        triggerId: trigger.triggerId,
      }),
    );
    const visited = new Set<string>();
    const visitedModules = new Set<string>();
    const analyzedVersions = new Set<string>([sourceVersion]);
    const startedAt = performance.now();
    let visitedCallsites = 0;
    let stopReason: AnalysisStopped["reason"] | undefined;

    function assertActive(): void {
      if (input.signal?.aborted === true) throw new AnalysisStopped("cancelled");
      if (performance.now() - startedAt > limits.analysisTimeoutMs) {
        throw new AnalysisStopped("timeout");
      }
      if (visitedCallsites >= limits.graphMaxCallsites) {
        throw new AnalysisStopped("callsites");
      }
      if (visitedModules.size >= limits.graphMaxModules) {
        throw new AnalysisStopped("modules");
      }
    }

    try {
      while (queue.length > 0) {
        assertActive();
        const entry = queue.shift();
        if (entry === undefined) break;
        const functionFile = entry.functionNode.getSourceFile();
        if (!isInsideRoot(root, functionFile.fileName)) continue;
        const visitKey = `${entry.triggerId}:${functionFile.fileName}:${String(entry.functionNode.pos)}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        visitedModules.add(functionFile.fileName);
        const functionCode = functionFile.getFullText();
        const functionVersion = createSourceVersion(functionCode);
        analyzedVersions.add(functionVersion);

        visitFunctionBody(entry.functionNode, (node) => {
          if (!ts.isCallExpression(node)) return;
          assertActive();
          visitedCallsites += 1;
          if (dependencies.length >= limits.graphMaxCallsites) {
            throw new AnalysisStopped("callsites");
          }
          const request = extractRequest(node, {
            checker,
            maximumVariants: limits.graphMaxCallsites - dependencies.length,
            sourceFile: functionFile,
          });

          if (request !== undefined) {
            const requestId = createAnalyzerId(
              "request",
              toDisplayPath(root, functionFile.fileName),
              functionVersion,
              node.getStart(functionFile),
            );
            const requestEvidenceId = createAnalyzerId(
              "evidence",
              toDisplayPath(root, functionFile.fileName),
              functionVersion,
              node.getStart(functionFile),
              "request",
            );
            evidence.push(
              Object.freeze({
                id: requestEvidenceId,
                kind: "source-anchor",
                source: sourceRef(
                  root,
                  functionFile,
                  node,
                  functionVersion,
                  options.registerSource,
                ),
                adapter: Object.freeze({ id: request.adapterId, version: "1" }),
                summaryKey: "dataFlow.evidence.requestCallsite",
              }),
            );
            const consumedFields = Object.freeze(
              collectConsumedFields(checker, node).slice(0, limits.reportMaxFields),
            );
            const suppliedBindings = Object.freeze(
              collectSuppliedBindings(checker, node, root).slice(
                0,
                limits.graphMaxCallsites,
              ),
            );

            for (const [variantIndex, variant] of request.variants.entries()) {
              const dependencyId = createAnalyzerId(
                "dependency",
                toDisplayPath(root, functionFile.fileName),
                functionVersion,
                node.getStart(functionFile),
                `${entry.triggerId}:${String(variantIndex)}`,
              );
              const parameters: DataParameter[] = request.parameters
                .slice(0, limits.reportMaxFields)
                .map((item) =>
                  Object.freeze({
                    ...item,
                    ...(variant.condition === undefined
                      ? {}
                      : { condition: variant.condition }),
                    sensitive: item.sensitive || isSensitiveName(item.path),
                    evidenceIds: Object.freeze([requestEvidenceId]),
                  }),
                );
              const existingQueryKeys = new Set(
                parameters
                  .filter(({ position }) => position === "query")
                  .map(({ path }) => path),
              );
              for (const queryKey of variant.url?.queryKeys ?? []) {
                if (parameters.length >= limits.reportMaxFields) break;
                if (existingQueryKeys.has(queryKey)) continue;
                parameters.push(
                  Object.freeze({
                    path: queryKey,
                    position: "query",
                    source: "url-query",
                    ...(variant.condition === undefined
                      ? {}
                      : { condition: variant.condition }),
                    sensitive: isSensitiveName(queryKey),
                    valueState: "not-collected",
                    evidenceIds: Object.freeze([requestEvidenceId]),
                  }),
                );
              }
              dependencies.push(
                Object.freeze({
                  id: dependencyId,
                  kind: request.kind,
                  direction: variant.direction,
                  execution: "declared-not-observed",
                  proof: "proven",
                  association: entry.depth === 0 ? "direct" : "transitive",
                  method: variant.method,
                  ...(variant.operation === undefined
                    ? {}
                    : { operation: variant.operation }),
                  ...(variant.url === undefined ? {} : { url: variant.url }),
                  parameters: Object.freeze(parameters),
                  response: Object.freeze({
                    consumedFields,
                  }),
                  origin: Object.freeze({
                    componentSourceId: componentId,
                    triggerCallsiteId: entry.triggerId,
                    requestCallsiteId: requestId,
                    sourceVersion: functionVersion,
                  }),
                  suppliedBindings,
                  locationIds: Object.freeze([]),
                  evidenceIds: Object.freeze([requestEvidenceId]),
                  observationIds: Object.freeze([]),
                }),
              );
            }
            if (request.variantsTruncated) {
              throw new AnalysisStopped("callsites");
            }
            return;
          }

          if (entry.depth >= limits.graphMaxDepth) return;
          const callee = resolveFunctionExpression(checker, node.expression, root);
          if (callee !== undefined) {
            queue.push(
              Object.freeze({
                depth: entry.depth + 1,
                functionNode: callee,
                triggerId: entry.triggerId,
              }),
            );
          }

          const callName = ts.isIdentifier(node.expression)
            ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name.text
              : undefined;
          if (callName !== undefined && CALLBACK_CALL_NAMES.has(callName)) {
            for (const argument of node.arguments) {
              const callback = resolveFunctionExpression(checker, argument, root);
              if (callback !== undefined) {
                queue.push(
                  Object.freeze({
                    depth: entry.depth + 1,
                    functionNode: callback,
                    triggerId: entry.triggerId,
                  }),
                );
              }
            }
          }
        });
      }
    } catch (error: unknown) {
      if (!(error instanceof AnalysisStopped)) throw error;
      stopReason = error.reason;
    }

    if (stopReason !== undefined) {
      const code: DataFlowDiagnosticCode =
        stopReason === "timeout"
          ? "DATA_FLOW_ANALYSIS_TIMEOUT"
          : "DATA_FLOW_ANALYSIS_TRUNCATED";
      diagnostics.push(diagnostic(`${reportId}_truncated`, code, "warning"));
    }

    return Object.freeze({
      schemaVersion: DATA_FLOW_SCHEMA_VERSION,
      reportId,
      baseline: Object.freeze({
        registryEpoch: options.registryEpoch,
        analyzerVersion: ANALYZER_VERSION,
        adapterSetHash: "builtin-v2",
        analyzedSourceVersions: Object.freeze([...analyzedVersions].sort()),
      }),
      capability: Object.freeze({
        enabled: true,
        staticAnalysis: stopReason === undefined ? "available" : "partial",
        runtimeObservation: "dispatch-only",
        responseShape: "consumed-fields-only",
        aiAssistance: "disabled",
        reasons: Object.freeze(
          stopReason === undefined
            ? []
            : [
                Object.freeze({
                  code:
                    stopReason === "timeout"
                      ? "DATA_FLOW_ANALYSIS_TIMEOUT"
                      : "DATA_FLOW_ANALYSIS_TRUNCATED",
                  retryable: stopReason === "timeout",
                }),
              ],
        ),
      }),
      component: Object.freeze({
        componentSourceId: componentId,
        ...(componentName === undefined ? {} : { displayName: componentName }),
        source: componentSource,
      }),
      dependencies: Object.freeze(dependencies),
      evidence: Object.freeze(evidence),
      diagnostics: Object.freeze(diagnostics),
      completeness: Object.freeze({
        complete: stopReason === undefined,
        visitedModules: visitedModules.size,
        visitedCallsites,
        frontierCount: queue.length,
        ...(stopReason === undefined || stopReason === "cancelled"
          ? {}
          : {
              truncatedBy:
                stopReason === "callsites"
                  ? "callsites"
                  : stopReason === "modules"
                    ? "modules"
                    : stopReason,
            }),
      }),
    });
  }

  return Object.freeze({
    analyzeComponent,
    invalidate(): void {
      programCache.clear();
      compilerOptionsByEntry.clear();
    },
  });
}

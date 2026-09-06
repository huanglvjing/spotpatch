import path from "node:path";

import {
  DATA_FLOW_QUERY_ADAPTER_MODULES,
  DATA_FLOW_QUERY_HOOK_NAMES,
  DATA_FLOW_TRPC_CLIENT_FACTORY_NAMES,
  DATA_FLOW_TRPC_PROXY_FACTORY_NAMES,
  DATA_FLOW_TRPC_REQUEST_METHODS,
} from "@spotpatch/shared";
import ts from "typescript";

import { createDataFlowAnchorId, createDataFlowSourceVersion } from "./data-flow-id.js";

const REQUEST_METHODS = new Set([
  "delete",
  "fetch",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
]);
const TRPC_REQUEST_METHODS = new Set<string>(DATA_FLOW_TRPC_REQUEST_METHODS);
const TRPC_CLIENT_FACTORY_NAMES = new Set<string>(DATA_FLOW_TRPC_CLIENT_FACTORY_NAMES);
const TRPC_PROXY_FACTORY_NAMES = new Set<string>(DATA_FLOW_TRPC_PROXY_FACTORY_NAMES);
const QUERY_HOOK_NAMES = new Set<string>(DATA_FLOW_QUERY_HOOK_NAMES);
const QUERY_ADAPTER_MODULES = new Set<string>(DATA_FLOW_QUERY_ADAPTER_MODULES);
const EFFECT_NAMES = new Set(["useEffect", "useLayoutEffect"]);
const TIMER_NAMES = new Set(["setInterval", "setTimeout"]);
const ASYNC_CALLBACK_METHODS = new Set(["catch", "finally", "then"]);

type FunctionImplementation =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

export interface DataFlowSourceEdit {
  readonly content: string;
  readonly offset: number;
  readonly placement: "left" | "right";
}

export interface DataFlowAnchor {
  readonly id: string;
  readonly kind: "component" | "request" | "trigger";
  readonly line: number;
  readonly column: number;
}

export interface DataFlowInstrumentationDiagnostic {
  readonly code:
    | "DATA_FLOW_CONCISE_TRIGGER_UNSUPPORTED"
    | "DATA_FLOW_GENERATOR_UNSUPPORTED"
    | "DATA_FLOW_TRPC_LINK_CONFIG_UNSUPPORTED"
    | "DATA_FLOW_UNSAFE_CALL_UNSUPPORTED";
  readonly line: number;
  readonly column: number;
}

export interface CollectDataFlowInstrumentationInput {
  readonly absolutePath: string;
  readonly code: string;
  readonly helperModule: string;
  readonly root: string;
  /** A padded browser script extracted from a non-JS source document. */
  readonly moduleScope?: Readonly<{ sourceVersion: string; importOffset: number }>;
}

export interface CollectedDataFlowInstrumentation {
  readonly anchors: readonly DataFlowAnchor[];
  readonly diagnostics: readonly DataFlowInstrumentationDiagnostic[];
  readonly edits: readonly DataFlowSourceEdit[];
  readonly sourceVersion: string;
}

interface FunctionRecord {
  readonly block: ts.Block;
  readonly componentId?: string;
  readonly node: FunctionImplementation;
  readonly tokenBinding: string;
}

interface ExternalTriggerRecord {
  readonly componentId: string;
  readonly expression: ts.Expression;
  readonly triggerId: string;
}

function isFunctionImplementation(node: ts.Node): node is FunctionImplementation {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function wrappedVariableDeclaration(
  node: FunctionImplementation,
  reactWrapperBindings: ReadonlySet<string>,
): ts.VariableDeclaration | undefined {
  const call = node.parent;
  if (
    !ts.isCallExpression(call) ||
    call.arguments[0] !== node ||
    !ts.isIdentifier(call.expression) ||
    !reactWrapperBindings.has(call.expression.text) ||
    !ts.isVariableDeclaration(call.parent) ||
    !ts.isIdentifier(call.parent.name)
  ) {
    return undefined;
  }
  return call.parent;
}

function functionName(
  node: FunctionImplementation,
  reactWrapperBindings: ReadonlySet<string>,
): string | undefined {
  const wrapped = wrappedVariableDeclaration(node, reactWrapperBindings);
  if (wrapped !== undefined) return wrapped.name.getText();
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.name === undefined ? undefined : propertyName(node.name);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function isComponentName(value: string | undefined): value is string {
  return value !== undefined && /^[A-Z]/u.test(value);
}

function blockBody(node: FunctionImplementation): ts.Block | undefined {
  return node.body !== undefined && ts.isBlock(node.body) ? node.body : undefined;
}

function displayPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function position(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Readonly<{ line: number; column: number }> {
  const value = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return Object.freeze({ line: value.line + 1, column: value.character + 1 });
}

function addDiagnostic(
  output: DataFlowInstrumentationDiagnostic[],
  code: DataFlowInstrumentationDiagnostic["code"],
  sourceFile: ts.SourceFile,
  node: ts.Node,
): void {
  output.push(Object.freeze({ code, ...position(sourceFile, node) }));
}

function isRequestCall(call: ts.CallExpression): boolean {
  if (ts.isIdentifier(call.expression)) return call.expression.text === "fetch";
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    (REQUEST_METHODS.has(call.expression.name.text.toLowerCase()) ||
      TRPC_REQUEST_METHODS.has(call.expression.name.text))
  );
}

function unsafeToWrap(call: ts.CallExpression): boolean {
  if (
    ts.isCallChain(call) ||
    call.expression.kind === ts.SyntaxKind.SuperKeyword ||
    call.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(call.expression) && call.expression.text === "eval")
  ) {
    return true;
  }

  let unsafe = false;
  function visit(node: ts.Node): void {
    if (unsafe || (node !== call && isFunctionImplementation(node))) return;
    if (ts.isYieldExpression(node) || ts.isAwaitExpression(node)) {
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  // The wrapper moves the entire call into a synchronous arrow, including
  // its receiver and computed property. Suspension anywhere in that evaluation
  // must stay in its original scope; nested function bodies own their scope.
  visit(call);
  return unsafe;
}

function lexicalFunction(
  node: ts.Node,
  functions: ReadonlyMap<FunctionImplementation, FunctionRecord>,
): FunctionRecord | undefined {
  let child = node;
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isFunctionImplementation(current)) {
      const record = functions.get(current);
      // Body-local tokens are not visible in parameter initializers or
      // computed method names, which execute outside the function body.
      if (record?.block === child) return record;
    }
    child = current;
    current = current.parent;
  }
  return undefined;
}

function resolveNamedFunction(
  name: string,
  useNode: ts.Node,
  functions: ReadonlyMap<FunctionImplementation, FunctionRecord>,
  namedFunctions: ReadonlyMap<string, readonly FunctionRecord[]>,
): FunctionRecord | undefined {
  const candidates = namedFunctions.get(name);
  if (candidates === undefined) return undefined;
  let scope = lexicalFunction(useNode, functions);

  while (scope !== undefined) {
    const candidate = candidates.find(
      (record) => lexicalFunction(record.node, functions) === scope,
    );
    if (candidate !== undefined) return candidate;
    scope = lexicalFunction(scope.node, functions);
  }

  return candidates.find(
    (record) => lexicalFunction(record.node, functions) === undefined,
  );
}

function resolveCallback(
  expression: ts.Expression,
  functions: ReadonlyMap<FunctionImplementation, FunctionRecord>,
  namedFunctions: ReadonlyMap<string, readonly FunctionRecord[]>,
): FunctionRecord | undefined {
  if (isFunctionImplementation(expression)) return functions.get(expression);
  return ts.isIdentifier(expression)
    ? resolveNamedFunction(expression.text, expression, functions, namedFunctions)
    : undefined;
}

function registrationOffset(
  node: FunctionImplementation,
  reactWrapperBindings: ReadonlySet<string>,
): number | undefined {
  if (ts.isFunctionDeclaration(node)) return node.end;
  const declaration =
    wrappedVariableDeclaration(node, reactWrapperBindings) ?? node.parent;
  const statement = declaration.parent.parent;
  return ts.isVariableDeclaration(declaration) && ts.isVariableStatement(statement)
    ? statement.end
    : undefined;
}

function reactWrapperBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "react" ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "memo" || imported === "forwardRef") {
        bindings.add(specifier.name.text);
      }
    }
  }
  return bindings;
}

function importedBindings(
  sourceFile: ts.SourceFile,
  moduleNames: ReadonlySet<string>,
  importedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !moduleNames.has(statement.moduleSpecifier.text) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (importedNames.has(imported)) bindings.add(specifier.name.text);
    }
  }
  return bindings;
}

function objectPropertyExpression(
  expression: ts.Expression | undefined,
  propertyKey: string,
): ts.Expression | undefined {
  if (expression === undefined || !ts.isObjectLiteralExpression(expression)) {
    return undefined;
  }
  const property = expression.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      propertyName(candidate.name) === propertyKey,
  );
  return property?.initializer;
}

function queryCallback(
  call: ts.CallExpression,
  queryBindings: ReadonlySet<string>,
  mutationBindings: ReadonlySet<string>,
): ts.Expression | undefined {
  if (!ts.isIdentifier(call.expression) || !queryBindings.has(call.expression.text)) {
    return undefined;
  }
  if (mutationBindings.has(call.expression.text)) {
    return (
      objectPropertyExpression(call.arguments[0], "mutationFn") ?? call.arguments[0]
    );
  }
  return objectPropertyExpression(call.arguments[0], "queryFn") ?? call.arguments[1];
}

function uniqueBinding(base: string, used: Set<string>): string {
  let candidate = base;
  let sequence = 0;
  while (used.has(candidate)) {
    sequence += 1;
    candidate = `${base}_${String(sequence)}`;
  }
  used.add(candidate);
  return candidate;
}

function importOffset(sourceFile: ts.SourceFile, code: string): number {
  let offset = code.startsWith("#!") ? code.indexOf("\n") + 1 || code.length : 0;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    offset = statement.end;
  }

  return offset;
}

function identifierSuffix(id: string): string {
  return id.replace(/[^A-Za-z0-9_$]/gu, "").slice(0, 12);
}

export function collectDataFlowInstrumentation(
  input: CollectDataFlowInstrumentationInput,
): CollectedDataFlowInstrumentation {
  const sourceFile = ts.createSourceFile(
    input.absolutePath,
    input.code,
    ts.ScriptTarget.Latest,
    true,
    input.absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relativePath = displayPath(input.root, input.absolutePath);
  const sourceVersion =
    input.moduleScope?.sourceVersion ?? createDataFlowSourceVersion(input.code);
  const wrapperBindings = reactWrapperBindings(sourceFile);
  const trpcClientFactories = importedBindings(
    sourceFile,
    new Set(["@trpc/client"]),
    TRPC_CLIENT_FACTORY_NAMES,
  );
  const trpcProxyFactories = importedBindings(
    sourceFile,
    new Set(["@trpc/next", "@trpc/react-query"]),
    TRPC_PROXY_FACTORY_NAMES,
  );
  const trpcProxyBindings = new Set<string>();
  function collectTrpcProxyBindings(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      trpcProxyFactories.has(node.initializer.expression.text)
    ) {
      trpcProxyBindings.add(node.name.text);
    }
    ts.forEachChild(node, collectTrpcProxyBindings);
  }
  collectTrpcProxyBindings(sourceFile);
  const queryBindings = importedBindings(
    sourceFile,
    QUERY_ADAPTER_MODULES,
    QUERY_HOOK_NAMES,
  );
  const mutationBindings = importedBindings(
    sourceFile,
    QUERY_ADAPTER_MODULES,
    new Set(["useMutation"]),
  );
  const usedBindings = new Set<string>();
  function collectBindings(node: ts.Node): void {
    if (ts.isIdentifier(node)) usedBindings.add(node.text);
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(sourceFile);
  const functions = new Map<FunctionImplementation, FunctionRecord>();
  const namedFunctions = new Map<string, FunctionRecord[]>();
  const anchors: DataFlowAnchor[] = [];
  const diagnostics: DataFlowInstrumentationDiagnostic[] = [];
  const edits: DataFlowSourceEdit[] = [];
  const triggerFunctions = new Map<FunctionRecord, string>();
  const renderTriggers = new Map<FunctionRecord, string>();
  const externalTriggers: ExternalTriggerRecord[] = [];

  function anchor(
    kind: DataFlowAnchor["kind"],
    node: ts.Node,
    discriminator = "",
  ): string {
    const id = createDataFlowAnchorId(
      kind,
      relativePath,
      sourceVersion,
      node.getStart(sourceFile),
      discriminator,
    );
    anchors.push(Object.freeze({ id, kind, ...position(sourceFile, node) }));
    return id;
  }

  function collectFunctions(node: ts.Node): void {
    if (isFunctionImplementation(node)) {
      const block = blockBody(node);
      if (block !== undefined) {
        const name = functionName(node, wrapperBindings);
        const componentId =
          input.moduleScope === undefined && isComponentName(name)
            ? anchor("component", node)
            : undefined;
        const functionId = createDataFlowAnchorId(
          "function",
          relativePath,
          sourceVersion,
          node.getStart(sourceFile),
        );
        const record = Object.freeze({
          block,
          ...(componentId === undefined ? {} : { componentId }),
          node,
          tokenBinding: uniqueBinding(
            `__spotpatchToken_${identifierSuffix(functionId)}`,
            usedBindings,
          ),
        });
        functions.set(node, record);
        if (name !== undefined) {
          const records = namedFunctions.get(name) ?? [];
          records.push(record);
          namedFunctions.set(name, records);
        }
      }
    }
    ts.forEachChild(node, collectFunctions);
  }
  collectFunctions(sourceFile);
  const moduleComponentId =
    input.moduleScope === undefined ? undefined : anchor("component", sourceFile);
  const moduleTriggerId =
    input.moduleScope === undefined
      ? undefined
      : anchor("trigger", sourceFile, "render");

  for (const record of functions.values()) {
    if (record.componentId !== undefined) {
      renderTriggers.set(record, anchor("trigger", record.node, "render"));
    }
  }

  function enclosingComponent(node: ts.Node): FunctionRecord | undefined {
    let scope: FunctionRecord | undefined = lexicalFunction(node, functions);
    while (scope !== undefined) {
      if (scope.componentId !== undefined) return scope;
      scope = lexicalFunction(scope.node, functions);
    }
    return undefined;
  }

  function addTrigger(record: FunctionRecord, node: ts.Node): void {
    const component = enclosingComponent(node);
    if (component?.componentId === undefined) return;
    triggerFunctions.set(record, anchor("trigger", node, component.componentId));
  }

  function addExternalTrigger(expression: ts.Expression, node: ts.Node): boolean {
    const component = enclosingComponent(node);
    const componentId = component?.componentId ?? moduleComponentId;
    if (componentId === undefined) return false;
    externalTriggers.push(
      Object.freeze({
        componentId,
        expression,
        triggerId: anchor("trigger", node, componentId),
      }),
    );
    return true;
  }

  function collectTriggers(node: ts.Node): void {
    if (
      moduleComponentId !== undefined &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener"
    ) {
      const callback = node.arguments[1];
      // Wrapping a named listener would break removeEventListener identity. A
      // listener function's body receives its trigger instead; inline callbacks
      // may be bound directly without changing an application's stored reference.
      if (callback !== undefined) {
        const record = resolveCallback(callback, functions, namedFunctions);
        if (record !== undefined)
          triggerFunctions.set(record, anchor("trigger", node, moduleComponentId));
        else if (isFunctionImplementation(callback)) addExternalTrigger(callback, node);
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      /^on[A-Z]/u.test(node.name.getText(sourceFile)) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined
    ) {
      const record = resolveCallback(
        node.initializer.expression,
        functions,
        namedFunctions,
      );
      if (record === undefined) {
        if (!addExternalTrigger(node.initializer.expression, node)) {
          addDiagnostic(
            diagnostics,
            "DATA_FLOW_CONCISE_TRIGGER_UNSUPPORTED",
            sourceFile,
            node,
          );
        }
      } else {
        addTrigger(record, node);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      EFFECT_NAMES.has(node.expression.text)
    ) {
      const callback = node.arguments[0];
      if (callback !== undefined) {
        const record = resolveCallback(callback, functions, namedFunctions);
        if (record !== undefined) addTrigger(record, node);
      }
    }

    if (ts.isCallExpression(node)) {
      const callback = queryCallback(node, queryBindings, mutationBindings);
      if (callback !== undefined) {
        const record = resolveCallback(callback, functions, namedFunctions);
        if (record === undefined) {
          if (!addExternalTrigger(callback, node)) {
            addDiagnostic(
              diagnostics,
              "DATA_FLOW_CONCISE_TRIGGER_UNSUPPORTED",
              sourceFile,
              node,
            );
          }
        } else {
          addTrigger(record, node);
        }
      }
    }
    ts.forEachChild(node, collectTriggers);
  }
  collectTriggers(sourceFile);

  const helper = uniqueBinding("__spotpatchDataFlow", usedBindings);
  const helperImportOffset = Math.max(
    importOffset(sourceFile, input.code),
    input.moduleScope?.importOffset ?? 0,
  );
  const moduleInvocation =
    moduleComponentId === undefined
      ? undefined
      : `${helper}.beginInvocation({componentSourceId:${JSON.stringify(moduleComponentId)},triggerCallsiteId:${JSON.stringify(moduleTriggerId)},sourceVersion:${JSON.stringify(sourceVersion)}})`;
  edits.push(
    Object.freeze({
      content: `${helperImportOffset === 0 || input.code[helperImportOffset - 1] === "\n" ? "" : "\n"}import { dataFlowRuntime as ${helper} } from ${JSON.stringify(input.helperModule)};\n`,
      offset: helperImportOffset,
      placement: "left",
    }),
  );

  for (const trigger of externalTriggers) {
    edits.push(
      Object.freeze({
        content: `${helper}.bindTrigger({componentSourceId:${JSON.stringify(trigger.componentId)},triggerCallsiteId:${JSON.stringify(trigger.triggerId)},sourceVersion:${JSON.stringify(sourceVersion)}},`,
        offset: trigger.expression.getStart(sourceFile),
        placement: "left",
      }),
      Object.freeze({
        content: ")",
        offset: trigger.expression.end,
        placement: "right",
      }),
    );
  }

  function instrumentTrpcLinks(node: ts.Node): void {
    const isDirectClientFactory =
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      trpcClientFactories.has(node.expression.text);
    const isProxyClientFactory =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "createClient" &&
      ts.isIdentifier(node.expression.expression) &&
      trpcProxyBindings.has(node.expression.expression.text);
    if (ts.isCallExpression(node) && (isDirectClientFactory || isProxyClientFactory)) {
      const options = node.arguments[0];
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        const links = options.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            propertyName(property.name) === "links",
        );
        if (links !== undefined && ts.isArrayLiteralExpression(links.initializer)) {
          edits.push(
            Object.freeze({
              content: `${helper}.createTrpcLink(),`,
              offset: links.initializer.getStart(sourceFile) + 1,
              placement: "left",
            }),
          );
        } else {
          addDiagnostic(
            diagnostics,
            "DATA_FLOW_TRPC_LINK_CONFIG_UNSUPPORTED",
            sourceFile,
            node,
          );
        }
      } else {
        addDiagnostic(
          diagnostics,
          "DATA_FLOW_TRPC_LINK_CONFIG_UNSUPPORTED",
          sourceFile,
          node,
        );
      }
    }
    ts.forEachChild(node, instrumentTrpcLinks);
  }
  instrumentTrpcLinks(sourceFile);

  for (const record of functions.values()) {
    if (record.node.asteriskToken !== undefined) {
      addDiagnostic(
        diagnostics,
        "DATA_FLOW_GENERATOR_UNSUPPORTED",
        sourceFile,
        record.node,
      );
      continue;
    }

    const triggerId = triggerFunctions.get(record);
    const initializer =
      record.componentId !== undefined
        ? `${helper}.beginInvocation({componentSourceId:${JSON.stringify(record.componentId)},triggerCallsiteId:${JSON.stringify(renderTriggers.get(record))},sourceVersion:${JSON.stringify(sourceVersion)}})`
        : triggerId === undefined
          ? `${helper}.captureInvocation()${moduleInvocation === undefined ? "" : `??${moduleInvocation}`}`
          : `${helper}.beginInvocation({componentSourceId:${JSON.stringify(
              (() => {
                let scope: FunctionRecord | undefined = lexicalFunction(
                  record.node,
                  functions,
                );
                while (scope !== undefined) {
                  if (scope.componentId !== undefined) return scope.componentId;
                  scope = lexicalFunction(scope.node, functions);
                }
                return moduleComponentId ?? "component_unknown";
              })(),
            )},triggerCallsiteId:${JSON.stringify(triggerId)},sourceVersion:${JSON.stringify(sourceVersion)}})`;
    edits.push(
      Object.freeze({
        content: `const ${record.tokenBinding}=${initializer};`,
        offset: record.block.getStart(sourceFile) + 1,
        placement: "left",
      }),
    );

    if (record.componentId !== undefined) {
      const offset = registrationOffset(record.node, wrapperBindings);
      const name = functionName(record.node, wrapperBindings);
      if (offset !== undefined && name !== undefined) {
        edits.push(
          Object.freeze({
            content: `\n${helper}.registerComponent(${name},${JSON.stringify(record.componentId)},${JSON.stringify(sourceVersion)});`,
            offset,
            placement: "right",
          }),
        );
      }
    }
  }

  function collectCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const owner = lexicalFunction(node, functions);
      const invocationBinding = owner?.tokenBinding ?? moduleInvocation;
      if (invocationBinding !== undefined && owner?.node.asteriskToken === undefined) {
        // An explicit event/effect trigger starts a new invocation even when it
        // fires synchronously inside another instrumented call (dispatchEvent).
        const invocation =
          owner !== undefined && triggerFunctions.has(owner)
            ? owner.tokenBinding
            : `${helper}.captureInvocation()??${invocationBinding}`;
        if (unsafeToWrap(node)) {
          addDiagnostic(
            diagnostics,
            "DATA_FLOW_UNSAFE_CALL_UNSUPPORTED",
            sourceFile,
            node,
          );
        } else if (isRequestCall(node)) {
          const requestId = anchor("request", node);
          edits.push(
            Object.freeze({
              content: `${helper}.withRequestFrame(${invocation},{requestCallsiteId:${JSON.stringify(requestId)},sourceVersion:${JSON.stringify(sourceVersion)}},()=>`,
              offset: node.getStart(sourceFile),
              placement: "left",
            }),
            Object.freeze({ content: ")", offset: node.end, placement: "right" }),
          );
        } else {
          const callName = ts.isIdentifier(node.expression)
            ? node.expression.text
            : undefined;
          const asynchronousCallbacks =
            callName !== undefined && TIMER_NAMES.has(callName)
              ? node.arguments.slice(0, 1)
              : ts.isPropertyAccessExpression(node.expression) &&
                  ASYNC_CALLBACK_METHODS.has(node.expression.name.text)
                ? node.arguments
                : [];
          for (const callback of asynchronousCallbacks) {
            if (!isFunctionImplementation(callback) && !ts.isIdentifier(callback)) {
              continue;
            }
            edits.push(
              Object.freeze({
                content: `${helper}.bindInvocation(${invocation},`,
                offset: callback.getStart(sourceFile),
                placement: "left",
              }),
              Object.freeze({
                content: ")",
                offset: callback.end,
                placement: "right",
              }),
            );
          }
          edits.push(
            Object.freeze({
              content: `${helper}.withInvocation(${invocation},()=>`,
              offset: node.getStart(sourceFile),
              placement: "left",
            }),
            Object.freeze({ content: ")", offset: node.end, placement: "right" }),
          );
        }
      }
    }
    ts.forEachChild(node, collectCalls);
  }
  collectCalls(sourceFile);

  return Object.freeze({
    anchors: Object.freeze(anchors),
    diagnostics: Object.freeze(diagnostics),
    edits: Object.freeze(edits),
    sourceVersion,
  });
}

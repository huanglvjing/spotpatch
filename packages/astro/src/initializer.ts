import path from "node:path";

import {
  applyIntegrationPlan,
  createIntegrationFileChange,
  integrationPathExists,
  readIntegrationFile,
  type IntegrationFileChange,
} from "@spotpatch/dev-server";
import { DEFAULT_AGENT_LIMITS } from "@spotpatch/shared";
import { MagicString } from "magic-string";
import {
  parseSync,
  Visitor,
  type ArrayExpression,
  type CallExpression,
  type ExportDefaultDeclaration,
  type Expression,
  type ImportDeclaration,
  type ObjectExpression,
  type ObjectProperty,
  type Program,
  type ReturnStatement,
} from "oxc-parser";

import { resolveAstroValidationChecks } from "./project-validation.js";

const ADAPTER_PACKAGE_NAME = "@spotpatch/astro";
const CONFIG_FILE_NAMES = Object.freeze([
  "astro.config.ts",
  "astro.config.mts",
  "astro.config.js",
  "astro.config.mjs",
] as const);

export interface AstroIntegrationPlan {
  readonly appRoot: string;
  readonly changes: readonly IntegrationFileChange[];
  readonly trustedFastModeAvailable: boolean;
}

export interface AstroIntegrationCheck {
  readonly appRoot: string;
  readonly issues: readonly string[];
  readonly ok: boolean;
  readonly trustedFastModeAvailable: boolean;
}

interface ParsedModule {
  readonly program: Program;
  readonly source: string;
}

function isParserErrorSeverity(value: unknown): boolean {
  return value === "Error";
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function parseModule(absolutePath: string, source: string): ParsedModule {
  const result = parseSync(absolutePath, source, {
    sourceType: "module",
    showSemanticErrors: true,
  });
  const error = result.errors.find((entry) => isParserErrorSeverity(entry.severity));
  if (error !== undefined) {
    throw new SyntaxError(
      `SpotPatch could not safely parse ${path.basename(absolutePath)} (${error.message}).`,
    );
  }
  return Object.freeze({ program: result.program, source });
}

function importsOf(program: Program): readonly ImportDeclaration[] {
  return program.body.filter(
    (statement): statement is ImportDeclaration =>
      statement.type === "ImportDeclaration",
  );
}

function importInsertionOffset(program: Program): number {
  const lastImport = importsOf(program).at(-1);
  if (lastImport !== undefined) return lastImport.end;

  const directives = program.body.filter(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      typeof statement.directive === "string",
  );
  return directives.at(-1)?.end ?? program.hashbang?.end ?? 0;
}

function insertImport(
  magicString: MagicString,
  program: Program,
  statement: string,
): void {
  const offset = importInsertionOffset(program);
  if (offset === 0) magicString.prepend(`${statement}\n`);
  else magicString.appendRight(offset, `\n${statement}`);
}

function importQuote(source: string, program: Program): '"' | "'" {
  const firstImport = importsOf(program)[0];
  const quote =
    firstImport === undefined ? undefined : source[firstImport.source.start];
  return quote === "'" ? "'" : '"';
}

function chooseIntegrationName(program: Program): string {
  const names = new Set<string>();
  new Visitor({
    Identifier(node) {
      names.add(node.name);
    },
  }).visit(program);
  let suffix = 0;
  let candidate = "spotPatch";
  while (names.has(candidate)) {
    suffix += 1;
    candidate = `spotPatch${String(suffix)}`;
  }
  return candidate;
}

function importedIntegrationName(program: Program): string | undefined {
  const adapterImports = importsOf(program).filter(
    (statement) => statement.source.value === ADAPTER_PACKAGE_NAME,
  );
  if (adapterImports.length > 1) {
    throw new Error("SpotPatch init found duplicate @spotpatch/astro imports.");
  }
  const adapterImport = adapterImports[0];
  if (adapterImport === undefined) return undefined;

  const defaultImport = adapterImport.specifiers.find(
    (specifier) => specifier.type === "ImportDefaultSpecifier",
  );
  if (defaultImport !== undefined) return defaultImport.local.name;

  const namedImport = adapterImport.specifiers.find(
    (specifier) =>
      specifier.type === "ImportSpecifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === "spotPatch" &&
      specifier.importKind !== "type",
  );
  if (namedImport?.type === "ImportSpecifier") return namedImport.local.name;
  throw new Error(
    "SpotPatch init cannot safely merge the existing @spotpatch/astro import.",
  );
}

function findDefaultExport(program: Program): ExportDefaultDeclaration {
  const exports = program.body.filter(
    (statement): statement is ExportDefaultDeclaration =>
      statement.type === "ExportDefaultDeclaration",
  );
  if (exports.length !== 1 || exports[0] === undefined) {
    throw new Error(
      "SpotPatch init requires exactly one ESM default export in astro.config.",
    );
  }
  return exports[0];
}

function findVariableInitializer(
  program: Program,
  name: string,
): Expression | undefined {
  for (const statement of program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      if (
        declaration.id.type === "Identifier" &&
        declaration.id.name === name &&
        declaration.init !== null
      ) {
        return declaration.init;
      }
    }
  }
  return undefined;
}

function resolveConfigExpression(program: Program): Expression {
  const exported = findDefaultExport(program).declaration;
  if (
    exported.type === "FunctionDeclaration" ||
    exported.type === "ClassDeclaration" ||
    exported.type === "TSInterfaceDeclaration"
  ) {
    throw new Error(
      "SpotPatch init requires astro.config to export a configuration expression.",
    );
  }
  const expression = unwrapExpression(exported);
  const resolved =
    expression.type === "Identifier"
      ? findVariableInitializer(program, expression.name)
      : expression;
  if (resolved === undefined) {
    throw new Error("SpotPatch init could not resolve the astro.config export.");
  }
  return unwrapExpression(resolved);
}

function resolveFactoryConfigObject(
  expression: Expression,
): ObjectExpression | undefined {
  const factory = unwrapExpression(expression);
  if (
    factory.type !== "ArrowFunctionExpression" &&
    factory.type !== "FunctionExpression"
  ) {
    return undefined;
  }
  if (factory.body === null) {
    throw new Error(
      "SpotPatch init cannot use a defineConfig callback without a body.",
    );
  }
  if (factory.body.type !== "BlockStatement") {
    const returned = unwrapExpression(factory.body);
    return returned.type === "ObjectExpression" ? returned : undefined;
  }
  const returns: ReturnStatement[] = [];
  new Visitor({
    ReturnStatement(statement) {
      returns.push(statement);
    },
  }).visit({
    type: "Program",
    body: factory.body.body,
    sourceType: "module",
    hashbang: null,
    start: factory.body.start,
    end: factory.body.end,
  });
  const onlyReturn = returns.length === 1 ? returns[0] : undefined;
  if (onlyReturn?.argument == null) {
    throw new Error(
      "SpotPatch init requires a defineConfig callback with exactly one top-level object return.",
    );
  }
  const returned = unwrapExpression(onlyReturn.argument);
  if (returned.type !== "ObjectExpression") {
    throw new Error(
      "SpotPatch init requires the defineConfig callback to return a configuration object directly.",
    );
  }
  return returned;
}

function resolveConfigObject(program: Program): ObjectExpression {
  const expression = resolveConfigExpression(program);
  if (expression.type === "ObjectExpression") return expression;
  if (expression.type === "CallExpression") {
    const callee = unwrapExpression(expression.callee);
    const argument = expression.arguments[0];
    if (
      callee.type === "Identifier" &&
      callee.name === "defineConfig" &&
      expression.arguments.length === 1 &&
      argument !== undefined &&
      argument.type !== "SpreadElement"
    ) {
      const value = unwrapExpression(argument);
      if (value.type === "ObjectExpression") return value;
      const callback = resolveFactoryConfigObject(value);
      if (callback !== undefined) return callback;
    }
  }
  throw new Error(
    "SpotPatch init supports a configuration object or an object-returning callback passed to defineConfig.",
  );
}

function propertyName(property: ObjectProperty): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string")
    return property.key.value;
  return undefined;
}

function findProperty(
  object: ObjectExpression,
  name: string,
): ObjectProperty | undefined {
  const matches = object.properties.filter(
    (property): property is ObjectProperty =>
      property.type === "Property" && propertyName(property) === name,
  );
  if (matches.length > 1) {
    throw new Error(`SpotPatch init found duplicate ${name} properties.`);
  }
  return matches[0];
}

function lineIndentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return /^[\t ]*/u.exec(source.slice(lineStart, offset))?.[0] ?? "";
}

function childIndent(source: string, object: ObjectExpression): string {
  const first = object.properties[0];
  return first === undefined
    ? `${lineIndentAt(source, object.start)}  `
    : lineIndentAt(source, first.start);
}

function initializedCall(name: string, trustedFastMode: boolean): string {
  const options = [
    "dataFlow: {}",
    "contextualAsk: {}",
    "externalAgent: true",
    ...(trustedFastMode ? ["trustedFastMode: true"] : []),
  ];
  return `${name}({ ${options.join(", ")} })`;
}

function integrationCalls(
  integrations: ArrayExpression,
  name: string,
): readonly CallExpression[] {
  return integrations.elements.filter((element): element is CallExpression => {
    if (element?.type !== "CallExpression") return false;
    const callee = unwrapExpression(element.callee);
    return callee.type === "Identifier" && callee.name === name;
  });
}

function enableBooleanOrObjectOption(
  magicString: MagicString,
  option: ObjectProperty | undefined,
  name: string,
  missing: string[],
): void {
  if (option === undefined) {
    missing.push(`${name}: {}`);
    return;
  }
  const value = unwrapExpression(option.value);
  if (value.type === "Literal" && value.value === false) {
    magicString.overwrite(value.start, value.end, "{}");
  } else if (value.type !== "ObjectExpression") {
    throw new Error(
      `SpotPatch init requires ${name} to be false or an options object.`,
    );
  }
}

function enableCallOptions(
  magicString: MagicString,
  source: string,
  call: CallExpression,
  trustedFastModeAvailable: boolean,
): void {
  if (call.arguments.length === 0) {
    magicString.overwrite(
      call.start,
      call.end,
      initializedCall(
        source.slice(call.start, call.callee.end),
        trustedFastModeAvailable,
      ),
    );
    return;
  }
  const argument = call.arguments[0];
  if (
    call.arguments.length !== 1 ||
    argument === undefined ||
    argument.type === "SpreadElement"
  ) {
    throw new Error("SpotPatch init cannot safely update the spotPatch options.");
  }
  const options = unwrapExpression(argument);
  if (options.type !== "ObjectExpression") {
    throw new Error("SpotPatch init requires spotPatch options to be an object.");
  }
  if (options.properties.some((property) => property.type === "SpreadElement")) {
    throw new Error(
      "SpotPatch init cannot prove required capabilities through spread spotPatch options.",
    );
  }
  const missing: string[] = [];
  enableBooleanOrObjectOption(
    magicString,
    findProperty(options, "dataFlow"),
    "dataFlow",
    missing,
  );
  enableBooleanOrObjectOption(
    magicString,
    findProperty(options, "contextualAsk"),
    "contextualAsk",
    missing,
  );

  const externalAgent = findProperty(options, "externalAgent");
  if (externalAgent === undefined) missing.push("externalAgent: true");
  else {
    const value = unwrapExpression(externalAgent.value);
    if (value.type !== "Literal" || typeof value.value !== "boolean") {
      throw new Error("SpotPatch init requires externalAgent to be a boolean literal.");
    }
    if (!value.value) magicString.overwrite(value.start, value.end, "true");
  }

  const trustedFastMode = findProperty(options, "trustedFastMode");
  if (trustedFastModeAvailable && trustedFastMode === undefined) {
    missing.push("trustedFastMode: true");
  } else if (trustedFastMode !== undefined) {
    const value = unwrapExpression(trustedFastMode.value);
    if (value.type !== "Literal" || typeof value.value !== "boolean") {
      throw new Error(
        "SpotPatch init requires trustedFastMode to be a boolean literal.",
      );
    }
    if (trustedFastModeAvailable && !value.value) {
      magicString.overwrite(value.start, value.end, "true");
    }
  }
  if (missing.length === 0) return;
  const indent = childIndent(source, options);
  if (options.properties.length === 0) {
    magicString.appendLeft(options.end - 1, ` ${missing.join(", ")} `);
  } else {
    magicString.appendLeft(
      options.properties[0]?.start ?? options.end - 1,
      `${missing.join(`,\n${indent}`)},\n${indent}`,
    );
  }
}

function addIntegration(
  magicString: MagicString,
  source: string,
  config: ObjectExpression,
  name: string,
  trustedFastModeAvailable: boolean,
): void {
  const property = findProperty(config, "integrations");
  const call = initializedCall(name, trustedFastModeAvailable);
  if (property === undefined) {
    const indent = childIndent(source, config);
    if (config.properties.length === 0) {
      magicString.appendLeft(config.end - 1, `\n${indent}integrations: [${call}],\n`);
    } else {
      magicString.appendLeft(
        config.properties[0]?.start ?? config.end - 1,
        `integrations: [${call}],\n${indent}`,
      );
    }
    return;
  }
  const value = unwrapExpression(property.value);
  if (value.type !== "ArrayExpression") {
    throw new Error(
      "SpotPatch init requires astro.config integrations to be an array.",
    );
  }
  const existing = integrationCalls(value, name);
  if (existing.length > 1) {
    throw new Error("SpotPatch init found duplicate spotPatch integrations.");
  }
  if (existing[0] !== undefined) {
    enableCallOptions(magicString, source, existing[0], trustedFastModeAvailable);
    return;
  }
  const first = value.elements.find((element) => element !== null);
  if (first === undefined) magicString.appendLeft(value.end - 1, call);
  else if (!source.slice(value.start, first.start).includes("\n")) {
    magicString.appendLeft(first.start, `${call}, `);
  } else {
    magicString.appendLeft(
      first.start,
      `${call},\n${lineIndentAt(source, first.start)}`,
    );
  }
}

function transformAstroConfig(
  absolutePath: string,
  source: string,
  trustedFastModeAvailable: boolean,
): string {
  const { program } = parseModule(absolutePath, source);
  const config = resolveConfigObject(program);
  const existingName = importedIntegrationName(program);
  const name = existingName ?? chooseIntegrationName(program);
  const magicString = new MagicString(source);
  if (existingName === undefined) {
    const specifier = name === "spotPatch" ? name : `spotPatch as ${name}`;
    const quote = importQuote(source, program);
    insertImport(
      magicString,
      program,
      `import { ${specifier} } from ${quote}${ADAPTER_PACKAGE_NAME}${quote};`,
    );
  }
  addIntegration(magicString, source, config, name, trustedFastModeAvailable);
  return magicString.toString();
}

async function findAstroConfig(appRoot: string): Promise<string> {
  const candidates = (
    await Promise.all(
      CONFIG_FILE_NAMES.map(async (name) => {
        const absolutePath = path.join(appRoot, name);
        return (await integrationPathExists(absolutePath)) ? absolutePath : undefined;
      }),
    )
  ).filter((value): value is string => value !== undefined);
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new Error("SpotPatch init requires exactly one supported astro.config file.");
  }
  return candidates[0];
}

async function hasTrustedFastMode(appRoot: string): Promise<boolean> {
  const checks = await resolveAstroValidationChecks({
    appRoot,
    checks: Object.freeze({}),
    timeoutMs: DEFAULT_AGENT_LIMITS.checkTimeoutMs,
  });
  return Object.values(checks).some((check) => check.required);
}

export async function planAstroIntegration(
  directory = process.cwd(),
): Promise<AstroIntegrationPlan> {
  const appRoot = path.resolve(directory);
  const configPath = await findAstroConfig(appRoot);
  const [source, trustedFastModeAvailable] = await Promise.all([
    readIntegrationFile(configPath),
    hasTrustedFastMode(appRoot),
  ]);
  const nextContent = transformAstroConfig(
    configPath,
    source,
    trustedFastModeAvailable,
  );
  const change = createIntegrationFileChange(appRoot, configPath, nextContent, source);
  return Object.freeze({
    appRoot,
    changes: Object.freeze(change === undefined ? [] : [change]),
    trustedFastModeAvailable,
  });
}

export async function applyAstroIntegrationPlan(
  plan: AstroIntegrationPlan,
): Promise<void> {
  await applyIntegrationPlan(plan);
}

export async function checkAstroIntegration(
  directory = process.cwd(),
): Promise<AstroIntegrationCheck> {
  try {
    const plan = await planAstroIntegration(directory);
    const issues = plan.changes.map(
      (change) => `INTEGRATION_REQUIRED:${change.relativePath}`,
    );
    return Object.freeze({
      appRoot: plan.appRoot,
      issues: Object.freeze(issues),
      ok: issues.length === 0,
      trustedFastModeAvailable: plan.trustedFastModeAvailable,
    });
  } catch (error: unknown) {
    return Object.freeze({
      appRoot: path.resolve(directory),
      issues: Object.freeze([
        error instanceof Error ? error.message : "SpotPatch integration check failed.",
      ]),
      ok: false,
      trustedFastModeAvailable: false,
    });
  }
}

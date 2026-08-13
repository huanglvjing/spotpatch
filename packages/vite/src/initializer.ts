import path from "node:path";

import {
  applyIntegrationPlan,
  createIntegrationFileChange,
  discoverProjectValidationCheck,
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

const ADAPTER_PACKAGE_NAME = "@spotpatch/vite";
const CONFIG_FILE_NAMES = Object.freeze([
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
] as const);

export interface ViteIntegrationPlan {
  readonly appRoot: string;
  readonly changes: readonly IntegrationFileChange[];
  readonly trustedFastModeAvailable: boolean;
}

export interface ViteIntegrationCheck {
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

  if (lastImport !== undefined) {
    return lastImport.end;
  }

  const directives = program.body.filter(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      typeof statement.directive === "string",
  );
  return directives.at(-1)?.end ?? program.hashbang?.end ?? 0;
}

function insertStaticImport(
  magicString: MagicString,
  program: Program,
  statement: string,
): void {
  const offset = importInsertionOffset(program);

  if (offset === 0) {
    magicString.prepend(`${statement}\n`);
    return;
  }

  magicString.appendRight(offset, `\n${statement}`);
}

function importQuote(source: string, program: Program): '"' | "'" {
  const firstImport = importsOf(program)[0];

  if (firstImport !== undefined) {
    const quote = source[firstImport.source.start];

    if (quote === '"' || quote === "'") {
      return quote;
    }
  }

  return '"';
}

function collectIdentifierNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  new Visitor({
    Identifier(node) {
      names.add(node.name);
    },
  }).visit(program);
  return names;
}

function choosePluginName(program: Program): string {
  const names = collectIdentifierNames(program);
  let suffix = 0;
  let candidate = "spotPatch";

  while (names.has(candidate)) {
    suffix += 1;
    candidate = `spotPatch${String(suffix)}`;
  }

  return candidate;
}

function importedPluginName(program: Program): string | undefined {
  const adapterImports = importsOf(program).filter(
    (statement) => statement.source.value === ADAPTER_PACKAGE_NAME,
  );

  if (adapterImports.length > 1) {
    throw new Error("SpotPatch init found duplicate @spotpatch/vite imports.");
  }

  const adapterImport = adapterImports[0];

  if (adapterImport === undefined) {
    return undefined;
  }

  const plugin = adapterImport.specifiers.find(
    (specifier) =>
      specifier.type === "ImportSpecifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === "spotPatch" &&
      specifier.importKind !== "type",
  );

  if (plugin === undefined) {
    throw new Error(
      "SpotPatch init cannot safely merge the existing @spotpatch/vite import.",
    );
  }

  return plugin.local.name;
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

function findDefaultExport(program: Program): ExportDefaultDeclaration {
  const exports = program.body.filter(
    (statement): statement is ExportDefaultDeclaration =>
      statement.type === "ExportDefaultDeclaration",
  );

  if (exports.length !== 1 || exports[0] === undefined) {
    throw new Error(
      "SpotPatch init requires exactly one ESM default export in vite.config.",
    );
  }

  return exports[0];
}

function findVariableInitializer(
  program: Program,
  name: string,
): Expression | undefined {
  for (const statement of program.body) {
    if (statement.type !== "VariableDeclaration") {
      continue;
    }

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
      "SpotPatch init requires vite.config to export a configuration expression.",
    );
  }

  const expression = unwrapExpression(exported);
  const resolved =
    expression.type === "Identifier"
      ? findVariableInitializer(program, expression.name)
      : expression;

  if (resolved === undefined) {
    throw new Error("SpotPatch init could not resolve the vite.config export.");
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

  if (expression.type === "ObjectExpression") {
    return expression;
  }

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

      if (value.type === "ObjectExpression") {
        return value;
      }

      const callbackObject = resolveFactoryConfigObject(value);

      if (callbackObject !== undefined) {
        return callbackObject;
      }
    }
  }

  throw new Error(
    "SpotPatch init supports a configuration object or an object-returning callback passed to defineConfig.",
  );
}

function propertyName(property: ObjectProperty): string | undefined {
  if (property.computed) {
    return undefined;
  }

  if (property.key.type === "Identifier") {
    return property.key.name;
  }

  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }

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

  if (first !== undefined) {
    return lineIndentAt(source, first.start);
  }

  return `${lineIndentAt(source, object.start)}  `;
}

function initializedPluginCall(pluginName: string, trustedFastMode: boolean): string {
  const options = [
    "dataFlow: {}",
    ...(trustedFastMode ? ["trustedFastMode: true"] : []),
  ];
  return `${pluginName}({ ${options.join(", ")} })`;
}

function directPluginCalls(
  plugins: ArrayExpression,
  pluginName: string,
): readonly CallExpression[] {
  return plugins.elements.filter((element): element is CallExpression => {
    if (element?.type !== "CallExpression") {
      return false;
    }

    const callee = unwrapExpression(element.callee);
    return callee.type === "Identifier" && callee.name === pluginName;
  });
}

function enableInitializedOptions(
  magicString: MagicString,
  source: string,
  call: CallExpression,
  trustedFastMode: boolean,
): void {
  if (call.arguments.length === 0) {
    magicString.overwrite(
      call.start,
      call.end,
      initializedPluginCall(source.slice(call.start, call.callee.end), trustedFastMode),
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

  const value = unwrapExpression(argument);

  if (value.type !== "ObjectExpression") {
    throw new Error("SpotPatch init requires spotPatch options to be an object.");
  }

  if (value.properties.some((property) => property.type === "SpreadElement")) {
    throw new Error(
      "SpotPatch init cannot prove dataFlow through spread spotPatch options.",
    );
  }

  const dataFlowProperty = findProperty(value, "dataFlow");
  const trustedFastModeProperty = findProperty(value, "trustedFastMode");
  const missingProperties: string[] = [];

  if (dataFlowProperty === undefined) {
    missingProperties.push("dataFlow: {}");
  } else {
    const dataFlowValue = unwrapExpression(dataFlowProperty.value);

    if (dataFlowValue.type === "Literal" && dataFlowValue.value === false) {
      magicString.overwrite(dataFlowValue.start, dataFlowValue.end, "{}");
    } else if (dataFlowValue.type !== "ObjectExpression") {
      throw new Error(
        "SpotPatch init requires dataFlow to be false or an options object.",
      );
    }
  }

  if (trustedFastMode && trustedFastModeProperty === undefined) {
    missingProperties.push("trustedFastMode: true");
  } else if (trustedFastModeProperty !== undefined) {
    const propertyValue = unwrapExpression(trustedFastModeProperty.value);

    if (propertyValue.type !== "Literal" || typeof propertyValue.value !== "boolean") {
      throw new Error(
        "SpotPatch init requires trustedFastMode to be a boolean literal.",
      );
    }

    if (trustedFastMode && !propertyValue.value) {
      magicString.overwrite(propertyValue.start, propertyValue.end, "true");
    }
  }

  if (missingProperties.length === 0) return;

  const indent = childIndent(source, value);

  if (value.properties.length === 0) {
    magicString.appendLeft(value.end - 1, ` ${missingProperties.join(", ")} `);
  } else {
    magicString.appendLeft(
      value.properties[0]?.start ?? value.end - 1,
      `${missingProperties.join(`,\n${indent}`)},\n${indent}`,
    );
  }
}

function addPluginCall(
  magicString: MagicString,
  source: string,
  config: ObjectExpression,
  pluginName: string,
  trustedFastModeAvailable: boolean,
): void {
  const pluginsProperty = findProperty(config, "plugins");
  const call = initializedPluginCall(pluginName, trustedFastModeAvailable);

  if (pluginsProperty === undefined) {
    const indent = childIndent(source, config);

    if (config.properties.length === 0) {
      magicString.appendLeft(config.end - 1, `\n${indent}plugins: [${call}],\n`);
    } else {
      magicString.appendLeft(
        config.properties[0]?.start ?? config.end - 1,
        `plugins: [${call}],\n${indent}`,
      );
    }

    return;
  }

  const value = unwrapExpression(pluginsProperty.value);

  if (value.type !== "ArrayExpression") {
    throw new Error("SpotPatch init requires vite.config plugins to be an array.");
  }

  const existing = directPluginCalls(value, pluginName);

  if (existing.length > 1) {
    throw new Error("SpotPatch init found duplicate spotPatch plugins.");
  }

  if (existing[0] !== undefined) {
    enableInitializedOptions(
      magicString,
      source,
      existing[0],
      trustedFastModeAvailable,
    );

    return;
  }

  const first = value.elements.find((element) => element !== null);

  if (first === undefined) {
    magicString.appendLeft(value.end - 1, call);
  } else if (!source.slice(value.start, first.start).includes("\n")) {
    magicString.appendLeft(first.start, `${call}, `);
  } else {
    magicString.appendLeft(
      first.start,
      `${call},\n${lineIndentAt(source, first.start)}`,
    );
  }
}

function transformViteConfig(
  absolutePath: string,
  source: string,
  trustedFastModeAvailable: boolean,
): string {
  const { program } = parseModule(absolutePath, source);
  const config = resolveConfigObject(program);
  const existingPluginName = importedPluginName(program);
  const pluginName = existingPluginName ?? choosePluginName(program);
  const magicString = new MagicString(source);

  if (existingPluginName === undefined) {
    const specifier =
      pluginName === "spotPatch" ? "spotPatch" : `spotPatch as ${pluginName}`;
    const quote = importQuote(source, program);
    insertStaticImport(
      magicString,
      program,
      `import { ${specifier} } from ${quote}${ADAPTER_PACKAGE_NAME}${quote};`,
    );
  }

  addPluginCall(magicString, source, config, pluginName, trustedFastModeAvailable);
  return magicString.toString();
}

async function findViteConfig(appRoot: string): Promise<string> {
  const candidates = (
    await Promise.all(
      CONFIG_FILE_NAMES.map(async (name) => {
        const absolutePath = path.join(appRoot, name);
        return (await integrationPathExists(absolutePath)) ? absolutePath : undefined;
      }),
    )
  ).filter((value): value is string => value !== undefined);

  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new Error("SpotPatch init requires exactly one supported vite.config file.");
  }

  return candidates[0];
}

export async function planViteIntegration(
  directory = process.cwd(),
): Promise<ViteIntegrationPlan> {
  const appRoot = path.resolve(directory);
  const configPath = await findViteConfig(appRoot);
  const [configSource, discoveredCheck] = await Promise.all([
    readIntegrationFile(configPath),
    discoverProjectValidationCheck({
      appRoot,
      timeoutMs: DEFAULT_AGENT_LIMITS.checkTimeoutMs,
    }),
  ]);
  const trustedFastModeAvailable = discoveredCheck !== undefined;
  const nextContent = transformViteConfig(
    configPath,
    configSource,
    trustedFastModeAvailable,
  );
  const change = createIntegrationFileChange(
    appRoot,
    configPath,
    nextContent,
    configSource,
  );

  return Object.freeze({
    appRoot,
    changes: Object.freeze(change === undefined ? [] : [change]),
    trustedFastModeAvailable,
  });
}

export async function applyViteIntegrationPlan(
  plan: ViteIntegrationPlan,
): Promise<void> {
  await applyIntegrationPlan(plan);
}

export async function checkViteIntegration(
  directory = process.cwd(),
): Promise<ViteIntegrationCheck> {
  try {
    const plan = await planViteIntegration(directory);
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

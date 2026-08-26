import path from "node:path";

import {
  applyIntegrationPlan,
  createIntegrationFileChange,
  discoverProjectValidationCheck,
  integrationPathExists,
  readIntegrationFile,
  type IntegrationFileChange,
} from "@spotpatch/dev-server";
import { DEFAULT_AGENT_LIMITS, SPOTPATCH_API_BASE } from "@spotpatch/shared";
import { MagicString } from "magic-string";
import {
  parseSync,
  Visitor,
  type CallExpression,
  type Expression,
  type ExportDefaultDeclaration,
  type ImportDeclaration,
  type ObjectExpression,
  type ObjectProperty,
  type Program,
} from "oxc-parser";

const ADAPTER_PACKAGE_NAME = "@spotpatch/next";
const CLIENT_MODULE_ID = "@spotpatch/next/client";
const CONFIG_FILE_NAMES = Object.freeze([
  "next.config.ts",
  "next.config.mts",
  "next.config.js",
  "next.config.mjs",
  "next.config.cts",
  "next.config.cjs",
] as const);
const INSTRUMENTATION_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const);
const PROXY_FILE_BASE_NAMES = Object.freeze(["proxy", "middleware"] as const);
const SPOTPATCH_MATCHER_EXCLUSION = "__spotpatch(?:/|$)";
const SIMPLE_SCRIPT_ARGUMENT_PATTERN = /^[A-Za-z0-9._:/=@%+,-]+$/u;

export interface NextIntegrationPlan {
  readonly appRoot: string;
  readonly changes: readonly IntegrationFileChange[];
  readonly trustedFastModeAvailable: boolean;
}

export interface NextIntegrationCheck {
  readonly appRoot: string;
  readonly issues: readonly string[];
  readonly ok: boolean;
  readonly trustedFastModeAvailable: boolean;
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly scripts?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

interface ParsedModule {
  readonly program: Program;
  readonly source: string;
}

function isParserErrorSeverity(value: unknown): boolean {
  return value === "Error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function staticStringLiteral(value: unknown): string | undefined {
  if (!isRecord(value) || value.type !== "Literal") return undefined;
  return typeof value.value === "string" ? value.value : undefined;
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
  const imports = importsOf(program);
  const lastImport = imports.at(-1);

  if (lastImport !== undefined) {
    return lastImport.end;
  }

  const directives = program.body.filter(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      "directive" in statement &&
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
    magicString.prepend(`${statement}${program.body.length === 0 ? "\n" : "\n\n"}`);
    return;
  }

  magicString.appendRight(offset, `\n${statement}`);
}

function findDefaultExport(program: Program): ExportDefaultDeclaration {
  const exports = program.body.filter(
    (statement): statement is ExportDefaultDeclaration =>
      statement.type === "ExportDefaultDeclaration",
  );

  if (exports.length !== 1) {
    throw new Error(
      "SpotPatch init requires exactly one ESM default export in next.config.",
    );
  }

  const defaultExport = exports[0];

  if (defaultExport === undefined) {
    throw new Error("SpotPatch init could not read the next.config default export.");
  }

  return defaultExport;
}

function importedWrapperName(program: Program): string | undefined {
  const adapterImports = importsOf(program).filter(
    (statement) => statement.source.value === ADAPTER_PACKAGE_NAME,
  );

  if (adapterImports.length > 1) {
    throw new Error(
      "SpotPatch init found multiple @spotpatch/next imports in next.config.",
    );
  }

  const adapterImport = adapterImports[0];

  if (adapterImport === undefined) {
    return undefined;
  }

  const wrapper = adapterImport.specifiers.find(
    (specifier) =>
      specifier.type === "ImportSpecifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === "withSpotPatch" &&
      specifier.importKind !== "type",
  );

  if (wrapper === undefined) {
    throw new Error(
      "SpotPatch init cannot safely merge the existing @spotpatch/next import.",
    );
  }

  return wrapper.local.name;
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

function chooseWrapperName(program: Program): string {
  const names = collectIdentifierNames(program);
  let suffix = 0;
  let candidate = "withSpotPatch";

  while (names.has(candidate)) {
    suffix += 1;
    candidate = `withSpotPatch${String(suffix)}`;
  }

  return candidate;
}

function unwrapParentheses(
  expression: CallExpression["callee"],
): CallExpression["callee"] {
  let current = expression;

  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }

  return current;
}

function wrappedFactoryCall(
  declaration: ExportDefaultDeclaration["declaration"],
  wrapperName: string,
): CallExpression | undefined {
  if (declaration.type !== "CallExpression" || declaration.arguments.length !== 1) {
    return undefined;
  }

  const factoryCall = unwrapParentheses(declaration.callee);

  if (factoryCall.type !== "CallExpression") {
    return undefined;
  }

  const callee = unwrapParentheses(factoryCall.callee);
  return callee.type === "Identifier" && callee.name === wrapperName
    ? factoryCall
    : undefined;
}

function staticPropertyName(property: ObjectProperty): string | undefined {
  if (property.computed) return undefined;

  if (property.key.type === "Identifier") return property.key.name;

  return property.key.type === "Literal" && typeof property.key.value === "string"
    ? property.key.value
    : undefined;
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

function findObjectProperty(
  object: ObjectExpression,
  name: string,
): ObjectProperty | undefined {
  const matches = object.properties.filter(
    (property): property is ObjectProperty =>
      property.type === "Property" && staticPropertyName(property) === name,
  );

  if (matches.length > 1) {
    throw new Error(`SpotPatch init found duplicate ${name} options.`);
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

function initializedNextOptions(trustedFastModeAvailable: boolean): string {
  return `{ externalAgent: true${trustedFastModeAvailable ? ", trustedFastMode: true" : ""} }`;
}

function enableNextOptions(
  magicString: MagicString,
  source: string,
  factory: CallExpression,
  trustedFastModeAvailable: boolean,
): void {
  const argument = factory.arguments[0];

  if (factory.arguments.length === 0) {
    magicString.appendLeft(
      factory.end - 1,
      initializedNextOptions(trustedFastModeAvailable),
    );
    return;
  }

  if (
    factory.arguments.length !== 1 ||
    argument === undefined ||
    argument.type === "SpreadElement"
  ) {
    throw new Error("SpotPatch init cannot safely update withSpotPatch options.");
  }

  const options = unwrapExpression(argument);

  if (options.type !== "ObjectExpression") {
    throw new Error("SpotPatch init requires withSpotPatch options to be an object.");
  }

  if (options.properties.some((property) => property.type === "SpreadElement")) {
    throw new Error(
      "SpotPatch init cannot prove externalAgent through spread withSpotPatch options.",
    );
  }

  const dataFlowProperty = findObjectProperty(options, "dataFlow");
  const dataFlowValue =
    dataFlowProperty === undefined
      ? undefined
      : unwrapExpression(dataFlowProperty.value);

  if (
    dataFlowValue !== undefined &&
    !(dataFlowValue.type === "Literal" && dataFlowValue.value === false)
  ) {
    throw new Error(
      "SpotPatch Next does not support component dataFlow yet; remove dataFlow or set it to false.",
    );
  }

  const missing: string[] = [];
  const externalAgentProperty = findObjectProperty(options, "externalAgent");

  if (externalAgentProperty === undefined) {
    missing.push("externalAgent: true");
  } else {
    const value = unwrapExpression(externalAgentProperty.value);

    if (value.type !== "Literal" || typeof value.value !== "boolean") {
      throw new Error("SpotPatch init requires externalAgent to be a boolean literal.");
    }

    if (!value.value) {
      magicString.overwrite(value.start, value.end, "true");
    }
  }

  const trustedFastModeProperty = findObjectProperty(options, "trustedFastMode");

  if (trustedFastModeAvailable && trustedFastModeProperty === undefined) {
    missing.push("trustedFastMode: true");
  } else if (trustedFastModeProperty !== undefined) {
    const value = unwrapExpression(trustedFastModeProperty.value);

    if (value.type !== "Literal" || typeof value.value !== "boolean") {
      throw new Error(
        "SpotPatch init requires trustedFastMode to be a boolean literal.",
      );
    }

    if (trustedFastModeAvailable && !value.value) {
      magicString.overwrite(value.start, value.end, "true");
    }
  }

  if (missing.length === 0) {
    return;
  }

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

function transformNextConfig(
  absolutePath: string,
  source: string,
  trustedFastModeAvailable: boolean,
): string {
  if (absolutePath.endsWith(".cjs") || absolutePath.endsWith(".cts")) {
    throw new Error(
      "SpotPatch init does not rewrite CommonJS next.config files; add withSpotPatch manually.",
    );
  }

  const { program } = parseModule(absolutePath, source);
  const defaultExport = findDefaultExport(program);
  const existingWrapperName = importedWrapperName(program);

  if (
    defaultExport.declaration.type === "FunctionDeclaration" ||
    defaultExport.declaration.type === "TSDeclareFunction" ||
    defaultExport.declaration.type === "ClassDeclaration" ||
    defaultExport.declaration.type === "TSInterfaceDeclaration"
  ) {
    throw new Error(
      "SpotPatch init cannot safely wrap this next.config default declaration; use an exported config expression.",
    );
  }

  const magicString = new MagicString(source);
  const wrapperName = existingWrapperName ?? chooseWrapperName(program);
  const existingFactory =
    existingWrapperName === undefined
      ? undefined
      : wrappedFactoryCall(defaultExport.declaration, existingWrapperName);

  if (existingFactory !== undefined) {
    enableNextOptions(magicString, source, existingFactory, trustedFastModeAvailable);
    return magicString.toString();
  }

  if (existingWrapperName === undefined) {
    const specifier =
      wrapperName === "withSpotPatch"
        ? "withSpotPatch"
        : `withSpotPatch as ${wrapperName}`;
    insertStaticImport(
      magicString,
      program,
      `import { ${specifier} } from ${JSON.stringify(ADAPTER_PACKAGE_NAME)};`,
    );
  }

  const expression = source.slice(
    defaultExport.declaration.start,
    defaultExport.declaration.end,
  );
  magicString.overwrite(
    defaultExport.declaration.start,
    defaultExport.declaration.end,
    `${wrapperName}(${initializedNextOptions(trustedFastModeAvailable)})(${expression})`,
  );
  return magicString.toString();
}

function transformInstrumentationClient(absolutePath: string, source: string): string {
  const { program } = parseModule(absolutePath, source);
  const clientImports = importsOf(program).filter(
    (statement) =>
      statement.source.value === CLIENT_MODULE_ID &&
      statement.importKind !== "type" &&
      (statement.specifiers.length === 0 ||
        statement.specifiers.some(
          (specifier) =>
            specifier.type !== "ImportSpecifier" || specifier.importKind !== "type",
        )),
  );

  if (clientImports.length > 1) {
    throw new Error("SpotPatch init found duplicate @spotpatch/next/client imports.");
  }

  if (clientImports.length === 1) {
    return source;
  }

  const magicString = new MagicString(source);
  insertStaticImport(
    magicString,
    program,
    `import ${JSON.stringify(CLIENT_MODULE_ID)};`,
  );
  return magicString.toString();
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

function resolveStaticNextConfigObject(program: Program): ObjectExpression | undefined {
  const exported = findDefaultExport(program).declaration;

  if (
    exported.type === "FunctionDeclaration" ||
    exported.type === "TSDeclareFunction" ||
    exported.type === "ClassDeclaration" ||
    exported.type === "TSInterfaceDeclaration"
  ) {
    return undefined;
  }

  let expression = unwrapExpression(exported);

  if (expression.type === "Identifier") {
    const initializer = findVariableInitializer(program, expression.name);
    expression = initializer === undefined ? expression : unwrapExpression(initializer);
  }

  if (expression.type === "CallExpression") {
    const factory = unwrapExpression(expression.callee);
    const hostArgument = expression.arguments[0];

    if (
      factory.type === "CallExpression" &&
      hostArgument !== undefined &&
      hostArgument.type !== "SpreadElement"
    ) {
      expression = unwrapExpression(hostArgument);

      if (expression.type === "Identifier") {
        const initializer = findVariableInitializer(program, expression.name);
        expression =
          initializer === undefined ? expression : unwrapExpression(initializer);
      }
    }
  }

  return expression.type === "ObjectExpression" ? expression : undefined;
}

function proxyFileExtensions(program: Program): readonly string[] {
  const extensions = new Set(
    INSTRUMENTATION_EXTENSIONS.map((extension) => extension.slice(1)),
  );
  const config = resolveStaticNextConfigObject(program);
  const pageExtensions =
    config === undefined ? undefined : findObjectProperty(config, "pageExtensions");

  if (pageExtensions === undefined) {
    return Object.freeze([...extensions]);
  }

  const value = unwrapExpression(pageExtensions.value);

  if (value.type !== "ArrayExpression") {
    throw new Error(
      "SPOTPATCH_PROXY_MATCHER_UNSAFE: pageExtensions must be a static string array so SpotPatch can inspect Proxy/Middleware files.",
    );
  }

  for (const element of value.elements) {
    const extension = staticStringLiteral(element);
    if (
      typeof extension !== "string" ||
      extension.length === 0 ||
      extension.includes("/") ||
      extension.includes("\\")
    ) {
      throw new Error(
        "SPOTPATCH_PROXY_MATCHER_UNSAFE: pageExtensions must contain only static filename extensions.",
      );
    }

    extensions.add(extension.replace(/^\.+/u, ""));
  }

  return Object.freeze([...extensions]);
}

function rewriteMatcherSource(value: string): string {
  if (value.includes(SPOTPATCH_MATCHER_EXCLUSION)) {
    return value;
  }

  if (value === SPOTPATCH_API_BASE || value.startsWith(`${SPOTPATCH_API_BASE}/`)) {
    throw new Error(
      `SPOTPATCH_PROXY_MATCHER_UNSAFE: Proxy/Middleware explicitly claims ${SPOTPATCH_API_BASE}.`,
    );
  }

  if (value.startsWith("/((?!")) {
    return `/((?!${SPOTPATCH_MATCHER_EXCLUSION}|${value.slice(5)}`;
  }

  if (
    value === "/:path*" ||
    value === "/:path(.*)" ||
    value === "/(.*)" ||
    value === "/:slug*"
  ) {
    return `/((?!${SPOTPATCH_MATCHER_EXCLUSION}).*)`;
  }

  if (value.startsWith("/:") || value.startsWith("/(")) {
    throw new Error(
      `SPOTPATCH_PROXY_MATCHER_UNSAFE: cannot safely exclude ${SPOTPATCH_API_BASE} from matcher ${JSON.stringify(value)}.`,
    );
  }

  return value;
}

function rewriteMatcherLiteral(magicString: MagicString, expression: Expression): void {
  const value = unwrapExpression(expression);

  if (value.type !== "Literal" || typeof value.value !== "string") {
    throw new Error(
      "SPOTPATCH_PROXY_MATCHER_UNSAFE: matcher entries must use static string sources.",
    );
  }

  const rewritten = rewriteMatcherSource(value.value);

  if (rewritten !== value.value) {
    magicString.overwrite(value.start, value.end, JSON.stringify(rewritten));
  }
}

function rewriteMatcherEntry(magicString: MagicString, expression: Expression): void {
  const value = unwrapExpression(expression);

  if (value.type !== "ObjectExpression") {
    rewriteMatcherLiteral(magicString, value);
    return;
  }

  if (value.properties.some((property) => property.type === "SpreadElement")) {
    throw new Error(
      "SPOTPATCH_PROXY_MATCHER_UNSAFE: matcher objects cannot contain spreads.",
    );
  }

  const source = findObjectProperty(value, "source");

  if (source === undefined) {
    throw new Error(
      "SPOTPATCH_PROXY_MATCHER_UNSAFE: matcher objects require a static source.",
    );
  }

  rewriteMatcherLiteral(magicString, source.value);
}

function transformProxyModule(absolutePath: string, source: string): string {
  if (absolutePath.endsWith(".cjs") || absolutePath.endsWith(".cts")) {
    throw new Error(
      "SPOTPATCH_PROXY_MATCHER_UNSAFE: CommonJS Proxy/Middleware requires a manual __spotpatch matcher exclusion.",
    );
  }

  const { program } = parseModule(absolutePath, source);
  const configDeclarations: ObjectExpression[] = [];
  let unsupportedConfigExport = false;

  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }

    const declaration = statement.declaration;

    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== "Identifier" || declarator.id.name !== "config") {
          continue;
        }

        if (declarator.init === null) {
          unsupportedConfigExport = true;
          continue;
        }

        const value = unwrapExpression(declarator.init);

        if (value.type === "ObjectExpression") {
          configDeclarations.push(value);
        } else {
          unsupportedConfigExport = true;
        }
      }
    }

    if (
      statement.specifiers.some(
        (specifier) =>
          specifier.exported.type === "Identifier" &&
          specifier.exported.name === "config",
      )
    ) {
      unsupportedConfigExport = true;
    }
  }

  if (unsupportedConfigExport || configDeclarations.length > 1) {
    throw new Error(
      "SPOTPATCH_PROXY_MATCHER_UNSAFE: export const config must be one static object.",
    );
  }

  const magicString = new MagicString(source);
  const config = configDeclarations[0];

  if (config === undefined) {
    if (collectIdentifierNames(program).has("config")) {
      throw new Error(
        "SPOTPATCH_PROXY_MATCHER_UNSAFE: a local config binding prevents a safe matcher export.",
      );
    }

    magicString.append(
      `${source.endsWith("\n") || source.length === 0 ? "" : "\n"}\nexport const config = { matcher: [${JSON.stringify(`/((?!${SPOTPATCH_MATCHER_EXCLUSION}).*)`)}] };\n`,
    );
    return magicString.toString();
  }

  const matcher = findObjectProperty(config, "matcher");

  if (matcher === undefined) {
    const indent = childIndent(source, config);
    const property = `matcher: [${JSON.stringify(`/((?!${SPOTPATCH_MATCHER_EXCLUSION}).*)`)}]`;

    if (config.properties.length === 0) {
      magicString.appendLeft(config.end - 1, `\n${indent}${property},\n`);
    } else {
      magicString.appendLeft(
        config.properties[0]?.start ?? config.end - 1,
        `${property},\n${indent}`,
      );
    }

    return magicString.toString();
  }

  const value = unwrapExpression(matcher.value);

  if (value.type === "ArrayExpression") {
    for (const element of value.elements) {
      if (element === null || element.type === "SpreadElement") {
        throw new Error(
          "SPOTPATCH_PROXY_MATCHER_UNSAFE: matcher arrays cannot contain holes or spreads.",
        );
      }

      rewriteMatcherEntry(magicString, element);
    }
  } else {
    rewriteMatcherEntry(magicString, value);
  }

  return magicString.toString();
}

async function findProxyModule(
  appRoot: string,
  configPath: string,
  configSource: string,
): Promise<string | undefined> {
  const { program } = parseModule(configPath, configSource);
  const extensions = proxyFileExtensions(program);
  const candidates = (
    await Promise.all(
      [appRoot, path.join(appRoot, "src")].flatMap((directory) =>
        PROXY_FILE_BASE_NAMES.flatMap((baseName) =>
          extensions.map(async (extension) => {
            const candidate = path.join(directory, `${baseName}.${extension}`);
            return (await integrationPathExists(candidate)) ? candidate : undefined;
          }),
        ),
      ),
    )
  ).filter((value): value is string => value !== undefined);

  if (candidates.length > 1) {
    throw new Error(
      `SPOTPATCH_PROXY_MATCHER_UNSAFE: found multiple Proxy/Middleware files (${candidates.map((candidate) => path.relative(appRoot, candidate)).join(", ")}).`,
    );
  }

  return candidates[0];
}

function parsePackageManifest(source: string): PackageManifest {
  let value: unknown;

  try {
    value = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    throw new SyntaxError("SpotPatch could not parse package.json.", {
      cause: error,
    });
  }

  if (!isRecord(value)) {
    throw new TypeError("SpotPatch requires package.json to contain an object.");
  }

  return value;
}

function hasAdapterDependency(manifest: PackageManifest): boolean {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ].some(
    (dependencies) =>
      isRecord(dependencies) && typeof dependencies[ADAPTER_PACKAGE_NAME] === "string",
  );
}

function transformDevScript(script: string): string {
  const tokens = script.trim().split(/\s+/u);

  if (tokens[0] === "spotpatch-next" && tokens[1] === "dev") {
    if (tokens.every((token) => SIMPLE_SCRIPT_ARGUMENT_PATTERN.test(token))) {
      return script;
    }

    throw new Error("SpotPatch init cannot verify the existing dev script safely.");
  }

  if (
    tokens[0] !== "next" ||
    tokens[1] !== "dev" ||
    !tokens.every((token) => SIMPLE_SCRIPT_ARGUMENT_PATTERN.test(token))
  ) {
    throw new Error("SpotPatch init only rewrites a simple `next dev` package script.");
  }

  return ["spotpatch-next", ...tokens.slice(1)].join(" ");
}

function detectIndent(source: string): string {
  return /^([\t ]+)"/mu.exec(source)?.[1] ?? "  ";
}

function transformPackageJson(source: string): string {
  const manifest = parsePackageManifest(source);

  if (!hasAdapterDependency(manifest)) {
    throw new Error(
      "SpotPatch init requires @spotpatch/next in package dependencies first.",
    );
  }

  if (!isRecord(manifest.scripts) || typeof manifest.scripts.dev !== "string") {
    throw new Error("SpotPatch init requires a string package script named dev.");
  }

  const dev = transformDevScript(manifest.scripts.dev);

  if (dev === manifest.scripts.dev) {
    return source;
  }

  const nextManifest = {
    ...manifest,
    scripts: { ...manifest.scripts, dev },
  };
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const serialized = JSON.stringify(nextManifest, undefined, detectIndent(source));
  return `${serialized.replaceAll("\n", lineEnding)}${lineEnding}`;
}

async function findNextConfig(appRoot: string): Promise<string> {
  const candidates = (
    await Promise.all(
      CONFIG_FILE_NAMES.map(async (name) => {
        const absolutePath = path.join(appRoot, name);
        return (await integrationPathExists(absolutePath)) ? absolutePath : undefined;
      }),
    )
  ).filter((value): value is string => value !== undefined);

  if (candidates.length !== 1) {
    throw new Error("SpotPatch init requires exactly one supported next.config file.");
  }

  const configPath = candidates[0];

  if (configPath === undefined) {
    throw new Error("SpotPatch init could not read the next.config path.");
  }

  return configPath;
}

async function resolveInstrumentationPath(
  appRoot: string,
  configPath: string,
): Promise<string> {
  const rootRouters = await Promise.all([
    integrationPathExists(path.join(appRoot, "app")),
    integrationPathExists(path.join(appRoot, "pages")),
  ]);
  const sourceRouters = await Promise.all([
    integrationPathExists(path.join(appRoot, "src", "app")),
    integrationPathExists(path.join(appRoot, "src", "pages")),
  ]);
  const hasRootRouter = rootRouters.some(Boolean);
  const hasSourceRouter = sourceRouters.some(Boolean);

  if (hasRootRouter && hasSourceRouter) {
    throw new Error(
      "SpotPatch init cannot choose an instrumentation location for mixed root/src routers.",
    );
  }

  if (!hasRootRouter && !hasSourceRouter) {
    throw new Error("SpotPatch init could not find an App or Pages Router.");
  }

  const directory = hasSourceRouter ? path.join(appRoot, "src") : appRoot;
  const existing = (
    await Promise.all(
      INSTRUMENTATION_EXTENSIONS.map(async (extension) => {
        const absolutePath = path.join(directory, `instrumentation-client${extension}`);
        return (await integrationPathExists(absolutePath)) ? absolutePath : undefined;
      }),
    )
  ).filter((value): value is string => value !== undefined);

  if (existing.length > 1) {
    throw new Error(
      "SpotPatch init found multiple instrumentation-client entry files.",
    );
  }

  if (existing[0] !== undefined) {
    return existing[0];
  }

  const useTypeScript =
    configPath.endsWith(".ts") ||
    configPath.endsWith(".mts") ||
    configPath.endsWith(".cts") ||
    (await integrationPathExists(path.join(appRoot, "tsconfig.json")));
  return path.join(directory, `instrumentation-client.${useTypeScript ? "ts" : "js"}`);
}

export async function planNextIntegration(
  directory = process.cwd(),
): Promise<NextIntegrationPlan> {
  const appRoot = path.resolve(directory);
  const packagePath = path.join(appRoot, "package.json");
  const [packageSource, configPath] = await Promise.all([
    readIntegrationFile(packagePath),
    findNextConfig(appRoot),
  ]);
  const [configSource, discoveredCheck] = await Promise.all([
    readIntegrationFile(configPath),
    discoverProjectValidationCheck({
      appRoot,
      timeoutMs: DEFAULT_AGENT_LIMITS.checkTimeoutMs,
    }),
  ]);
  const trustedFastModeAvailable = discoveredCheck !== undefined;
  const instrumentationPath = await resolveInstrumentationPath(appRoot, configPath);
  const proxyPath = await findProxyModule(appRoot, configPath, configSource);
  const instrumentationSource = (await integrationPathExists(instrumentationPath))
    ? await readIntegrationFile(instrumentationPath)
    : undefined;
  const proxySource =
    proxyPath === undefined ? undefined : await readIntegrationFile(proxyPath);
  const changes = [
    createIntegrationFileChange(
      appRoot,
      configPath,
      transformNextConfig(configPath, configSource, trustedFastModeAvailable),
      configSource,
    ),
    createIntegrationFileChange(
      appRoot,
      instrumentationPath,
      transformInstrumentationClient(instrumentationPath, instrumentationSource ?? ""),
      instrumentationSource,
    ),
    createIntegrationFileChange(
      appRoot,
      packagePath,
      transformPackageJson(packageSource),
      packageSource,
    ),
    ...(proxyPath === undefined || proxySource === undefined
      ? []
      : [
          createIntegrationFileChange(
            appRoot,
            proxyPath,
            transformProxyModule(proxyPath, proxySource),
            proxySource,
          ),
        ]),
  ].filter((change): change is IntegrationFileChange => change !== undefined);

  return Object.freeze({
    appRoot,
    changes: Object.freeze(changes),
    trustedFastModeAvailable,
  });
}

export async function applyNextIntegrationPlan(
  plan: NextIntegrationPlan,
): Promise<void> {
  await applyIntegrationPlan(plan);
}

export async function checkNextIntegration(
  directory = process.cwd(),
): Promise<NextIntegrationCheck> {
  try {
    const plan = await planNextIntegration(directory);
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

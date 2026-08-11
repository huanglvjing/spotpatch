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
  type CallExpression,
  type ExportDefaultDeclaration,
  type ImportDeclaration,
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
    magicString.prepend(`${statement}\n\n`);
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

function hasTrustedFastMode(call: CallExpression): boolean {
  const argument = call.arguments[0];

  if (
    call.arguments.length !== 1 ||
    argument === undefined ||
    argument.type === "SpreadElement" ||
    argument.type !== "ObjectExpression"
  ) {
    return false;
  }

  return argument.properties.some(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      property.key.type === "Identifier" &&
      property.key.name === "trustedFastMode" &&
      property.value.type === "Literal" &&
      property.value.value === true,
  );
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
    if (
      trustedFastModeAvailable &&
      existingFactory.arguments.length === 0 &&
      !hasTrustedFastMode(existingFactory)
    ) {
      magicString.overwrite(
        existingFactory.start,
        existingFactory.end,
        `${wrapperName}({ trustedFastMode: true })`,
      );
      return magicString.toString();
    }

    return source;
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
    `${wrapperName}(${trustedFastModeAvailable ? "{ trustedFastMode: true }" : ""})(${expression})`,
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
  const instrumentationSource = (await integrationPathExists(instrumentationPath))
    ? await readIntegrationFile(instrumentationPath)
    : undefined;
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

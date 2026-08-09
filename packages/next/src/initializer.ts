import { randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

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

export interface IntegrationFileChange {
  readonly absolutePath: string;
  readonly nextContent: string;
  readonly previousContent?: string;
  readonly relativePath: string;
}

export interface NextIntegrationPlan {
  readonly appRoot: string;
  readonly changes: readonly IntegrationFileChange[];
}

export interface NextIntegrationCheck {
  readonly appRoot: string;
  readonly issues: readonly string[];
  readonly ok: boolean;
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

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readRegularFile(absolutePath: string): Promise<string> {
  const metadata = await lstat(absolutePath);

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(
      `SpotPatch refuses to modify the non-regular file ${path.basename(absolutePath)}.`,
    );
  }

  return readFile(absolutePath, "utf8");
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

function isWrappedDefaultExport(
  declaration: ExportDefaultDeclaration["declaration"],
  wrapperName: string,
): boolean {
  if (declaration.type !== "CallExpression" || declaration.arguments.length !== 1) {
    return false;
  }

  const factoryCall = unwrapParentheses(declaration.callee);

  if (factoryCall.type !== "CallExpression") {
    return false;
  }

  const callee = unwrapParentheses(factoryCall.callee);
  return callee.type === "Identifier" && callee.name === wrapperName;
}

function transformNextConfig(absolutePath: string, source: string): string {
  if (absolutePath.endsWith(".cjs") || absolutePath.endsWith(".cts")) {
    throw new Error(
      "SpotPatch init does not rewrite CommonJS next.config files; add withSpotPatch manually.",
    );
  }

  const { program } = parseModule(absolutePath, source);
  const defaultExport = findDefaultExport(program);
  const existingWrapperName = importedWrapperName(program);

  if (
    existingWrapperName !== undefined &&
    isWrappedDefaultExport(defaultExport.declaration, existingWrapperName)
  ) {
    return source;
  }

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
    `${wrapperName}()(${expression})`,
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
        return (await pathExists(absolutePath)) ? absolutePath : undefined;
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
    pathExists(path.join(appRoot, "app")),
    pathExists(path.join(appRoot, "pages")),
  ]);
  const sourceRouters = await Promise.all([
    pathExists(path.join(appRoot, "src", "app")),
    pathExists(path.join(appRoot, "src", "pages")),
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
        return (await pathExists(absolutePath)) ? absolutePath : undefined;
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
    (await pathExists(path.join(appRoot, "tsconfig.json")));
  return path.join(directory, `instrumentation-client.${useTypeScript ? "ts" : "js"}`);
}

function createChange(
  appRoot: string,
  absolutePath: string,
  nextContent: string,
  previousContent: string | undefined,
): IntegrationFileChange | undefined {
  if (previousContent === nextContent) {
    return undefined;
  }

  return Object.freeze({
    absolutePath,
    nextContent,
    ...(previousContent === undefined ? {} : { previousContent }),
    relativePath: path.relative(appRoot, absolutePath).split(path.sep).join("/"),
  });
}

export async function planNextIntegration(
  directory = process.cwd(),
): Promise<NextIntegrationPlan> {
  const appRoot = path.resolve(directory);
  const packagePath = path.join(appRoot, "package.json");
  const [packageSource, configPath] = await Promise.all([
    readRegularFile(packagePath),
    findNextConfig(appRoot),
  ]);
  const configSource = await readRegularFile(configPath);
  const instrumentationPath = await resolveInstrumentationPath(appRoot, configPath);
  const instrumentationSource = (await pathExists(instrumentationPath))
    ? await readRegularFile(instrumentationPath)
    : undefined;
  const changes = [
    createChange(
      appRoot,
      configPath,
      transformNextConfig(configPath, configSource),
      configSource,
    ),
    createChange(
      appRoot,
      instrumentationPath,
      transformInstrumentationClient(instrumentationPath, instrumentationSource ?? ""),
      instrumentationSource,
    ),
    createChange(
      appRoot,
      packagePath,
      transformPackageJson(packageSource),
      packageSource,
    ),
  ].filter((change): change is IntegrationFileChange => change !== undefined);

  return Object.freeze({ appRoot, changes: Object.freeze(changes) });
}

function temporaryPath(absolutePath: string, label: string): string {
  return path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.spotpatch-${label}-${String(process.pid)}-${randomBytes(8).toString("hex")}`,
  );
}

async function writeAtomic(
  absolutePath: string,
  content: string,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const stagedPath = temporaryPath(absolutePath, "stage");

  try {
    await writeFile(stagedPath, content, { encoding: "utf8", flag: "wx", mode });
    await rename(stagedPath, absolutePath);
  } catch (error: unknown) {
    await unlink(stagedPath).catch(() => undefined);
    throw error;
  }
}

async function rollbackChange(change: IntegrationFileChange): Promise<void> {
  if (change.previousContent === undefined) {
    await unlink(change.absolutePath).catch(() => undefined);
    return;
  }

  const mode = (await stat(change.absolutePath)).mode;
  await writeAtomic(change.absolutePath, change.previousContent, mode);
}

export async function applyNextIntegrationPlan(
  plan: NextIntegrationPlan,
): Promise<void> {
  const applied: IntegrationFileChange[] = [];

  try {
    for (const change of plan.changes) {
      const mode =
        change.previousContent === undefined
          ? 0o600
          : (await stat(change.absolutePath)).mode;
      await writeAtomic(change.absolutePath, change.nextContent, mode);
      applied.push(change);
    }
  } catch (error: unknown) {
    const rollbackResults = await Promise.allSettled(
      applied.reverse().map(rollbackChange),
    );

    if (rollbackResults.some((result) => result.status === "rejected")) {
      throw new Error(
        "SpotPatch init failed and could not completely restore the previous files.",
        { cause: error },
      );
    }

    throw new Error("SpotPatch init failed; all written files were restored.", {
      cause: error,
    });
  }
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
    });
  } catch (error: unknown) {
    return Object.freeze({
      appRoot: path.resolve(directory),
      issues: Object.freeze([
        error instanceof Error ? error.message : "SpotPatch integration check failed.",
      ]),
      ok: false,
    });
  }
}

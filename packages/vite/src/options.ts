import type { ContextBudget } from "@spotpatch/shared";

export type FilterEntry = string | RegExp;

export interface SpotPatchOptions {
  readonly enabled?: boolean;
  readonly include?: readonly FilterEntry[];
  readonly exclude?: readonly FilterEntry[];
  readonly editor?: "vscode";
  readonly redact?: boolean;
  readonly budget?: Partial<ContextBudget>;
  readonly shortcut?: string;
  readonly allowLan?: boolean;
  readonly debug?: boolean;
}

export interface ResolvedSpotPatchOptions {
  readonly enabled: boolean;
  readonly include: readonly FilterEntry[];
  readonly exclude: readonly FilterEntry[];
  readonly editor: "vscode";
  readonly redact: boolean;
  readonly budget: Readonly<ContextBudget>;
  readonly shortcut: string;
  readonly allowLan: boolean;
  readonly debug: boolean;
}

export const DEFAULT_EXCLUDE = Object.freeze([
  /node_modules/,
  /\.test\.[jt]sx$/,
  /\.spec\.[jt]sx$/,
  /\.stories\.[jt]sx$/,
  /(?:^|\/)dist(?:\/|$)/,
  /(?:^|\/)coverage(?:\/|$)/,
]);

const DEFAULT_INCLUDE = Object.freeze([/(?:^|[/\\])src[/\\].+\.(?:jsx|tsx)$/]);

const DEFAULT_BUDGET = Object.freeze({
  totalCharacters: 16_000,
  domCharacters: 3_000,
  cssCharacters: 4_000,
  codeCharacters: 7_000,
  maxCodeLines: 80,
  maxComponentDepth: 8,
} satisfies ContextBudget);

export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  include: DEFAULT_INCLUDE,
  exclude: DEFAULT_EXCLUDE,
  editor: "vscode",
  redact: true,
  budget: DEFAULT_BUDGET,
  shortcut: "Mod+Shift+S",
  allowLan: false,
  debug: false,
} satisfies ResolvedSpotPatchOptions);

function assertPositiveBudget(budget: Readonly<ContextBudget>): void {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`SpotPatch budget ${name} must be a positive integer.`);
    }
  }
}

export function resolveOptions(
  options: SpotPatchOptions = {},
): ResolvedSpotPatchOptions {
  const budget = Object.freeze({
    ...DEFAULT_OPTIONS.budget,
    ...options.budget,
  });

  assertPositiveBudget(budget);

  const resolved = {
    enabled: options.enabled ?? DEFAULT_OPTIONS.enabled,
    include: Object.freeze([...(options.include ?? DEFAULT_OPTIONS.include)]),
    exclude: Object.freeze([...(options.exclude ?? DEFAULT_OPTIONS.exclude)]),
    editor: options.editor ?? DEFAULT_OPTIONS.editor,
    redact: options.redact ?? DEFAULT_OPTIONS.redact,
    budget,
    shortcut: options.shortcut ?? DEFAULT_OPTIONS.shortcut,
    allowLan: options.allowLan ?? DEFAULT_OPTIONS.allowLan,
    debug: options.debug ?? DEFAULT_OPTIONS.debug,
  } satisfies ResolvedSpotPatchOptions;

  if (resolved.shortcut.trim().length === 0) {
    throw new RangeError("SpotPatch shortcut cannot be empty.");
  }

  return Object.freeze(resolved);
}

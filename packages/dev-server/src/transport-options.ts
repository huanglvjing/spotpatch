import type {
  AiOptions,
  ContextBudget,
  ResolvedAiOptions,
  SpotPatchEditorPreference,
  SpotPatchLocalePreference,
} from "@spotpatch/shared";

import {
  resolveOptions,
  type FilterEntry,
  type ResolvedSpotPatchOptions,
  type SpotPatchDataFlowOptions,
} from "./options.js";

interface SerializedStringFilter {
  readonly kind: "string";
  readonly value: string;
}

interface SerializedRegExpFilter {
  readonly flags: string;
  readonly kind: "regexp";
  readonly source: string;
}

export type SerializedFilterEntry = SerializedRegExpFilter | SerializedStringFilter;

export interface SerializedSpotPatchOptions {
  readonly ai: false | AiOptions;
  readonly allowLan: boolean;
  readonly budget: Readonly<ContextBudget>;
  readonly debug: boolean;
  readonly dataFlow: false | SpotPatchDataFlowOptions;
  readonly editor: SpotPatchEditorPreference;
  readonly enabled: boolean;
  readonly exclude: readonly SerializedFilterEntry[];
  readonly include: readonly SerializedFilterEntry[];
  readonly locale: SpotPatchLocalePreference;
  readonly maxTargets: number;
  readonly redact: boolean;
  readonly shortcut: string;
}

const OPTION_KEYS = Object.freeze([
  "ai",
  "allowLan",
  "budget",
  "debug",
  "dataFlow",
  "editor",
  "enabled",
  "exclude",
  "include",
  "locale",
  "maxTargets",
  "redact",
  "shortcut",
] as const);
const BUDGET_KEYS = Object.freeze([
  "totalCharacters",
  "domCharacters",
  "cssCharacters",
  "codeCharacters",
  "maxCodeLines",
  "maxComponentDepth",
] as const);
const REGEXP_FLAGS_PATTERN = /^(?!.*(.).*\1)[dgimsuvy]*$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function serializeFilter(entry: FilterEntry): SerializedFilterEntry {
  return typeof entry === "string"
    ? Object.freeze({ kind: "string", value: entry })
    : Object.freeze({
        flags: entry.flags,
        kind: "regexp",
        source: entry.source,
      });
}

function serializeAiOptions(options: ResolvedAiOptions): AiOptions {
  return Object.freeze({
    providers: Object.freeze(
      Object.fromEntries(
        Object.entries(options.providers).map(([id, provider]) => [
          id,
          Object.freeze({
            type: provider.type,
            label: provider.label,
            protocol: provider.protocol,
            authentication: provider.authentication,
            baseURL: provider.baseURL,
            apiKeyEnv: provider.apiKeyEnv,
            models: Object.freeze(
              Object.fromEntries(
                Object.entries(provider.models).map(([modelId, model]) => [
                  modelId,
                  Object.freeze({ label: model.label, model: model.model }),
                ]),
              ),
            ),
            defaultModel: provider.defaultModel,
          }),
        ]),
      ),
    ),
    defaultProvider: options.defaultProvider,
    execution: Object.freeze({
      isolation: options.execution.isolation,
      applyMode: options.execution.applyMode,
      checks: Object.freeze(
        Object.fromEntries(
          Object.entries(options.execution.checks).map(([id, check]) => [
            id,
            Object.freeze({
              label: check.label,
              command: check.command,
              args: check.args,
              required: check.required,
              timeoutMs: check.timeoutMs,
            }),
          ]),
        ),
      ),
      limits: options.execution.limits,
    }),
  });
}

export function serializeResolvedSpotPatchOptions(
  options: ResolvedSpotPatchOptions,
): SerializedSpotPatchOptions {
  return Object.freeze({
    ai: options.ai === false ? false : serializeAiOptions(options.ai),
    allowLan: options.allowLan,
    budget: options.budget,
    debug: options.debug,
    dataFlow: options.dataFlow.enabled
      ? Object.freeze({
          runtime: options.dataFlow.runtime,
        })
      : false,
    editor: options.editor,
    enabled: options.enabled,
    exclude: Object.freeze(options.exclude.map(serializeFilter)),
    include: Object.freeze(options.include.map(serializeFilter)),
    locale: options.locale,
    maxTargets: options.maxTargets,
    redact: options.redact,
    shortcut: options.shortcut,
  });
}

function parseFilterList(value: unknown): readonly FilterEntry[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new TypeError("The SpotPatch filter transport is invalid.");
  }

  return Object.freeze(
    value.map((entry: unknown): FilterEntry => {
      if (!isRecord(entry)) {
        throw new TypeError("The SpotPatch filter transport is invalid.");
      }

      if (
        entry.kind === "string" &&
        hasExactKeys(entry, ["kind", "value"]) &&
        typeof entry.value === "string" &&
        entry.value.length > 0 &&
        entry.value.length <= 1_024 &&
        !entry.value.includes("\0")
      ) {
        return entry.value;
      }

      if (
        entry.kind === "regexp" &&
        hasExactKeys(entry, ["flags", "kind", "source"]) &&
        typeof entry.source === "string" &&
        entry.source.length <= 1_024 &&
        typeof entry.flags === "string" &&
        REGEXP_FLAGS_PATTERN.test(entry.flags)
      ) {
        try {
          return new RegExp(entry.source, entry.flags);
        } catch {
          throw new TypeError("The SpotPatch filter transport is invalid.");
        }
      }

      throw new TypeError("The SpotPatch filter transport is invalid.");
    }),
  );
}

function parseBudget(value: unknown): Readonly<ContextBudget> {
  if (!isRecord(value) || !hasExactKeys(value, BUDGET_KEYS)) {
    throw new TypeError("The SpotPatch budget transport is invalid.");
  }

  const budget = Object.fromEntries(
    BUDGET_KEYS.map((key) => [key, value[key]]),
  ) as unknown as ContextBudget;

  return Object.freeze(budget);
}

function parseDataFlow(value: unknown): false | SpotPatchDataFlowOptions {
  if (value === false) return false;

  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["runtime"]) ||
    value.runtime !== "dispatch"
  ) {
    throw new TypeError("The SpotPatch data-flow transport is invalid.");
  }

  return Object.freeze({
    runtime: value.runtime,
  });
}

export function parseSerializedSpotPatchOptions(
  value: unknown,
): ResolvedSpotPatchOptions {
  if (!isRecord(value) || !hasExactKeys(value, OPTION_KEYS)) {
    throw new TypeError("The SpotPatch options transport is invalid.");
  }

  if (
    typeof value.enabled !== "boolean" ||
    typeof value.redact !== "boolean" ||
    typeof value.allowLan !== "boolean" ||
    typeof value.debug !== "boolean" ||
    typeof value.shortcut !== "string" ||
    typeof value.maxTargets !== "number" ||
    typeof value.editor !== "string" ||
    typeof value.locale !== "string" ||
    (value.ai !== false && !isRecord(value.ai))
  ) {
    throw new TypeError("The SpotPatch options transport is invalid.");
  }

  try {
    return resolveOptions({
      ai: value.ai as AiOptions | false,
      allowLan: value.allowLan,
      budget: parseBudget(value.budget),
      debug: value.debug,
      dataFlow: parseDataFlow(value.dataFlow),
      editor: value.editor as SpotPatchEditorPreference,
      enabled: value.enabled,
      exclude: parseFilterList(value.exclude),
      include: parseFilterList(value.include),
      locale: value.locale as SpotPatchLocalePreference,
      maxTargets: value.maxTargets,
      redact: value.redact,
      shortcut: value.shortcut,
    });
  } catch (error: unknown) {
    throw new TypeError("The SpotPatch options transport is invalid.", {
      cause: error,
    });
  }
}

import {
  DEFAULT_AGENT_LIMITS,
  MAX_ANNOTATION_TARGETS,
  SPOTPATCH_LOCALE_PREFERENCES,
  type AgentLimits,
  type AiExecutionOptions,
  type AiOptions,
  type AiProviderAuthentication,
  type AiProviderProtocol,
  type ContextBudget,
  type ResolvedAgentCheckDefinition,
  type ResolvedAiModelProfile,
  type ResolvedAiOptions,
  type ResolvedOpenAICompatibleProviderOptions,
  type RuntimeAiConfig,
  type SpotPatchLocalePreference,
} from "@spotpatch/shared";
import { z } from "zod";

export type {
  AgentApplyMode,
  AgentCheckDefinition,
  AgentLimits,
  AiExecutionOptions,
  AiModelProfile,
  AiOptions,
  AiProviderAuthentication,
  AiProviderProtocol,
  OpenAICompatibleProviderOptions,
} from "@spotpatch/shared";

export type FilterEntry = string | RegExp;

export interface SimpleAiOptions {
  readonly baseURL: string;
  readonly model: string;
  readonly apiKeyEnv?: string;
  readonly protocol?: AiProviderProtocol;
  readonly authentication?: AiProviderAuthentication;
  readonly providerLabel?: string;
  readonly modelLabel?: string;
  readonly execution?: AiExecutionOptions;
}

export type SpotPatchAiOptions = false | SimpleAiOptions | AiOptions;

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
  readonly locale?: SpotPatchLocalePreference;
  readonly maxTargets?: number;
  readonly ai?: SpotPatchAiOptions;
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
  readonly locale: SpotPatchLocalePreference;
  readonly maxTargets: number;
  readonly ai: false | ResolvedAiOptions;
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
  locale: "auto",
  maxTargets: 8,
  ai: false,
} satisfies ResolvedSpotPatchOptions);

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

const agentLimitsSchema = z
  .strictObject({
    maxTurns: z.number().optional(),
    maxToolCalls: z.number().optional(),
    maxChangedFiles: z.number().optional(),
    maxDiffBytes: z.number().optional(),
    maxReadBytesPerFile: z.number().optional(),
    maxToolOutputCharacters: z.number().optional(),
    maxProviderResponseBytes: z.number().optional(),
    providerConnectTimeoutMs: z.number().optional(),
    providerFirstByteTimeoutMs: z.number().optional(),
    providerIdleTimeoutMs: z.number().optional(),
    checkTimeoutMs: z.number().optional(),
    jobTimeoutMs: z.number().optional(),
  })
  .optional();

const agentCheckSchema = z.strictObject({
  label: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  timeoutMs: z.number().optional(),
});

type ParsedAgentCheck = z.infer<typeof agentCheckSchema>;
type ParsedAgentLimits = Readonly<
  Partial<Record<keyof AgentLimits, number | undefined>>
>;

const aiOptionsSchema = z.strictObject({
  providers: z.record(
    z.string(),
    z.strictObject({
      type: z.literal("openai-compatible"),
      label: z.string(),
      protocol: z.enum(["responses", "chat-completions"]),
      authentication: z.enum(["bearer", "x-api-key"]).optional(),
      baseURL: z.string(),
      apiKeyEnv: z.string(),
      models: z.record(
        z.string(),
        z.strictObject({ label: z.string(), model: z.string() }),
      ),
      defaultModel: z.string(),
    }),
  ),
  defaultProvider: z.string(),
  execution: z
    .strictObject({
      isolation: z.literal("git-worktree").optional(),
      applyMode: z.enum(["review", "auto"]).optional(),
      checks: z.record(z.string(), agentCheckSchema).optional(),
      limits: agentLimitsSchema,
    })
    .optional(),
});

const simpleAiOptionsSchema = z.strictObject({
  baseURL: z.string(),
  model: z.string(),
  apiKeyEnv: z.string().optional(),
  protocol: z.enum(["responses", "chat-completions"]).optional(),
  authentication: z.enum(["bearer", "x-api-key"]).optional(),
  providerLabel: z.string().optional(),
  modelLabel: z.string().optional(),
  execution: aiOptionsSchema.shape.execution,
});

type ParsedAiOptions = z.infer<typeof aiOptionsSchema>;

function assertIdentifier(value: string, label: string): void {
  if (!PROFILE_ID_PATTERN.test(value)) {
    throw new RangeError(
      `SpotPatch ${label} must contain only letters, numbers, dot, underscore, or hyphen.`,
    );
  }
}

function nonEmpty(value: string, label: string, maximum = 256): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maximum || value.includes("\0")) {
    throw new RangeError(`SpotPatch ${label} is invalid.`);
  }

  return normalized;
}

function normalizeProviderBaseURL(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new RangeError("SpotPatch AI provider baseURL must be a valid URL.");
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const allowedProtocol =
    url.protocol === "https:" ||
    (url.protocol === "http:" && loopbackHosts.has(url.hostname));

  if (
    !allowedProtocol ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new RangeError("SpotPatch AI provider baseURL violates URL policy.");
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function resolveLimits(limits: ParsedAgentLimits | undefined): Readonly<AgentLimits> {
  const resolved = Object.freeze({
    maxTurns: limits?.maxTurns ?? DEFAULT_AGENT_LIMITS.maxTurns,
    maxToolCalls: limits?.maxToolCalls ?? DEFAULT_AGENT_LIMITS.maxToolCalls,
    maxChangedFiles: limits?.maxChangedFiles ?? DEFAULT_AGENT_LIMITS.maxChangedFiles,
    maxDiffBytes: limits?.maxDiffBytes ?? DEFAULT_AGENT_LIMITS.maxDiffBytes,
    maxReadBytesPerFile:
      limits?.maxReadBytesPerFile ?? DEFAULT_AGENT_LIMITS.maxReadBytesPerFile,
    maxToolOutputCharacters:
      limits?.maxToolOutputCharacters ?? DEFAULT_AGENT_LIMITS.maxToolOutputCharacters,
    maxProviderResponseBytes:
      limits?.maxProviderResponseBytes ?? DEFAULT_AGENT_LIMITS.maxProviderResponseBytes,
    providerConnectTimeoutMs:
      limits?.providerConnectTimeoutMs ?? DEFAULT_AGENT_LIMITS.providerConnectTimeoutMs,
    providerFirstByteTimeoutMs:
      limits?.providerFirstByteTimeoutMs ??
      DEFAULT_AGENT_LIMITS.providerFirstByteTimeoutMs,
    providerIdleTimeoutMs:
      limits?.providerIdleTimeoutMs ?? DEFAULT_AGENT_LIMITS.providerIdleTimeoutMs,
    checkTimeoutMs: limits?.checkTimeoutMs ?? DEFAULT_AGENT_LIMITS.checkTimeoutMs,
    jobTimeoutMs: limits?.jobTimeoutMs ?? DEFAULT_AGENT_LIMITS.jobTimeoutMs,
  } satisfies AgentLimits);

  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`SpotPatch AI limit ${name} must be a positive integer.`);
    }
  }

  return resolved;
}

function resolveModels(
  models: ParsedAiOptions["providers"][string]["models"],
): Readonly<Record<string, ResolvedAiModelProfile>> {
  const entries = Object.entries(models);

  if (entries.length === 0) {
    throw new RangeError("SpotPatch AI provider must declare at least one model.");
  }

  return Object.freeze(
    Object.fromEntries(
      entries.map(([id, model]) => {
        assertIdentifier(id, "model profile id");
        return [
          id,
          Object.freeze({
            id,
            label: nonEmpty(model.label, "model label", 100),
            model: nonEmpty(model.model, "provider model name"),
          } satisfies ResolvedAiModelProfile),
        ];
      }),
    ),
  );
}

function resolveProviders(
  providers: ParsedAiOptions["providers"],
): Readonly<Record<string, ResolvedOpenAICompatibleProviderOptions>> {
  const entries = Object.entries(providers);

  if (entries.length === 0) {
    throw new RangeError("SpotPatch AI must declare at least one provider.");
  }

  return Object.freeze(
    Object.fromEntries(
      entries.map(([id, provider]) => {
        assertIdentifier(id, "provider profile id");

        if (
          !ENV_NAME_PATTERN.test(provider.apiKeyEnv) ||
          provider.apiKeyEnv.startsWith("VITE_")
        ) {
          throw new RangeError(
            "SpotPatch AI apiKeyEnv must be an uppercase non-VITE environment name.",
          );
        }

        const models = resolveModels(provider.models);

        if (!(provider.defaultModel in models)) {
          throw new RangeError(
            "SpotPatch AI provider defaultModel must reference a configured model.",
          );
        }

        return [
          id,
          Object.freeze({
            id,
            type: provider.type,
            label: nonEmpty(provider.label, "provider label", 100),
            protocol: provider.protocol,
            authentication: provider.authentication ?? "bearer",
            baseURL: normalizeProviderBaseURL(provider.baseURL),
            apiKeyEnv: provider.apiKeyEnv,
            models,
            defaultModel: provider.defaultModel,
          } satisfies ResolvedOpenAICompatibleProviderOptions),
        ];
      }),
    ),
  );
}

function resolveChecks(
  checks: Readonly<Record<string, ParsedAgentCheck>> | undefined,
  defaultTimeoutMs: number,
): Readonly<Record<string, ResolvedAgentCheckDefinition>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(checks ?? {}).map(([id, check]) => {
        assertIdentifier(id, "check id");
        const timeoutMs = check.timeoutMs ?? defaultTimeoutMs;

        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
          throw new RangeError("SpotPatch AI check timeout must be positive.");
        }

        const args = Object.freeze(
          [...(check.args ?? [])].map((argument) =>
            nonEmpty(argument, "check argument", 4_096),
          ),
        );

        return [
          id,
          Object.freeze({
            id,
            label: nonEmpty(check.label, "check label", 100),
            command: nonEmpty(check.command, "check command", 1_024),
            args,
            required: check.required ?? true,
            timeoutMs,
          } satisfies ResolvedAgentCheckDefinition),
        ];
      }),
    ),
  );
}

function resolveAiOptions(
  options: SpotPatchAiOptions | undefined,
): false | ResolvedAiOptions {
  if (options === undefined || options === false) {
    return false;
  }

  const expanded =
    "providers" in options
      ? options
      : (() => {
          const simple = simpleAiOptionsSchema.safeParse(options);

          if (!simple.success) {
            throw new RangeError("SpotPatch AI configuration is invalid.");
          }

          const providerId = "default";
          const modelId = "default";

          return {
            providers: {
              [providerId]: {
                type: "openai-compatible",
                label: simple.data.providerLabel ?? "AI provider",
                protocol: simple.data.protocol ?? "chat-completions",
                authentication: simple.data.authentication ?? "bearer",
                baseURL: simple.data.baseURL,
                apiKeyEnv: simple.data.apiKeyEnv ?? "SPOTPATCH_AI_API_KEY",
                models: {
                  [modelId]: {
                    label: simple.data.modelLabel ?? "AI model",
                    model: simple.data.model,
                  },
                },
                defaultModel: modelId,
              },
            },
            defaultProvider: providerId,
            ...(simple.data.execution === undefined
              ? {}
              : { execution: simple.data.execution }),
          };
        })();
  const parsed = aiOptionsSchema.safeParse(expanded);

  if (!parsed.success) {
    throw new RangeError("SpotPatch AI configuration is invalid.");
  }

  const validated = parsed.data;
  const limits = resolveLimits(validated.execution?.limits);
  const checks = resolveChecks(validated.execution?.checks, limits.checkTimeoutMs);
  const applyMode = validated.execution?.applyMode ?? "review";

  if (applyMode === "auto" && !Object.values(checks).some((check) => check.required)) {
    throw new RangeError("SpotPatch AI auto mode requires a required check.");
  }

  const providers = resolveProviders(validated.providers);

  if (!(validated.defaultProvider in providers)) {
    throw new RangeError(
      "SpotPatch AI defaultProvider must reference a configured provider.",
    );
  }

  return Object.freeze({
    providers,
    defaultProvider: validated.defaultProvider,
    execution: Object.freeze({
      isolation: "git-worktree",
      applyMode,
      checks,
      limits,
    }),
  });
}

export function createRuntimeAiConfig(
  options: false | ResolvedAiOptions,
): RuntimeAiConfig {
  if (options === false) {
    return Object.freeze({ enabled: false });
  }

  return Object.freeze({
    enabled: true,
    defaultProvider: options.defaultProvider,
    applyMode: options.execution.applyMode,
    providers: Object.freeze(
      Object.values(options.providers).map((provider) =>
        Object.freeze({
          id: provider.id,
          label: provider.label,
          protocol: provider.protocol,
          defaultModel: provider.defaultModel,
          models: Object.freeze(
            Object.values(provider.models).map((model) =>
              Object.freeze({ id: model.id, label: model.label }),
            ),
          ),
        }),
      ),
    ),
  });
}

function assertPositiveBudget(budget: Readonly<ContextBudget>): void {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`SpotPatch budget ${name} must be a positive integer.`);
    }
  }
}

export function resolveOptions(
  options: SpotPatchOptions = {},
  environmentAi?: false | SimpleAiOptions,
): ResolvedSpotPatchOptions {
  const budget = Object.freeze({
    ...DEFAULT_OPTIONS.budget,
    ...options.budget,
  });

  assertPositiveBudget(budget);

  const maxTargets = options.maxTargets ?? DEFAULT_OPTIONS.maxTargets;
  const locale = options.locale ?? DEFAULT_OPTIONS.locale;

  if (!(SPOTPATCH_LOCALE_PREFERENCES as readonly string[]).includes(locale)) {
    throw new RangeError("SpotPatch locale must be auto, en-US, or zh-CN.");
  }

  if (
    !Number.isSafeInteger(maxTargets) ||
    maxTargets < 1 ||
    maxTargets > MAX_ANNOTATION_TARGETS
  ) {
    throw new RangeError(
      `SpotPatch maxTargets must be an integer between 1 and ${String(MAX_ANNOTATION_TARGETS)}.`,
    );
  }

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
    locale,
    maxTargets,
    ai: resolveAiOptions(options.ai ?? environmentAi),
  } satisfies ResolvedSpotPatchOptions;

  if (resolved.shortcut.trim().length === 0) {
    throw new RangeError("SpotPatch shortcut cannot be empty.");
  }

  return Object.freeze(resolved);
}

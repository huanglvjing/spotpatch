import { z } from "zod";

import { SPOTPATCH_API_BASE } from "../protocol/endpoints.js";
import { MAX_ANNOTATION_TARGETS, SPOTPATCH_LOCALE_PREFERENCES } from "./annotation.js";
import { SPOTPATCH_EDITOR_PREFERENCES } from "./editor.js";
import type { ContextBudget } from "./code-context.js";
import { AGENT_APPLY_MODES, type RuntimeAiConfig } from "./agent.js";
import {
  runtimeDataFlowConfigSchema,
  type RuntimeDataFlowConfig,
} from "./data-flow.js";

export const SPOTPATCH_NEXT_BUNDLERS = Object.freeze(["turbopack", "webpack"] as const);
export const SPOTPATCH_NEXT_ROUTER_KINDS = Object.freeze([
  "app",
  "pages",
  "hybrid",
] as const);

export type SpotPatchNextBundler = (typeof SPOTPATCH_NEXT_BUNDLERS)[number];
export type SpotPatchNextRouterKind = (typeof SPOTPATCH_NEXT_ROUTER_KINDS)[number];

interface RuntimeConfigBase {
  readonly apiBase: typeof SPOTPATCH_API_BASE;
  readonly ai: RuntimeAiConfig;
  readonly budget: Readonly<ContextBudget>;
  readonly contextualAsk: Readonly<{ enabled: boolean }>;
  readonly dataFlow: RuntimeDataFlowConfig;
  readonly debug: boolean;
  readonly editor: (typeof SPOTPATCH_EDITOR_PREFERENCES)[number];
  readonly externalAgent: Readonly<{ enabled: boolean }>;
  readonly frameworkVersion: string;
  readonly locale: (typeof SPOTPATCH_LOCALE_PREFERENCES)[number];
  readonly maxTargets: number;
  readonly redact: boolean;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly shortcut: string;
  readonly spotPatchVersion: string;
}

export type SpotPatchRuntimeConfig = RuntimeConfigBase &
  (
    | Readonly<{
        framework: "vite";
      }>
    | Readonly<{
        bundler: SpotPatchNextBundler;
        framework: "next";
        routerKind: SpotPatchNextRouterKind;
      }>
  );

const boundedText = (maximum: number): z.ZodString =>
  z.string().trim().min(1).max(maximum);
const profileIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const runtimeAiModelSchema = z.strictObject({
  id: profileIdSchema,
  label: boundedText(100),
});
const runtimeAiProviderSchema = z
  .strictObject({
    id: profileIdSchema,
    label: boundedText(100),
    protocol: z.enum(["responses", "chat-completions"]),
    models: z.array(runtimeAiModelSchema).min(1).max(64),
    defaultModel: profileIdSchema,
  })
  .refine(
    ({ defaultModel, models }) =>
      models.some(({ id }) => id === defaultModel) &&
      new Set(models.map(({ id }) => id)).size === models.length,
    { message: "Runtime AI model profiles are inconsistent." },
  );
const runtimeAiConfigSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false) }),
  z
    .strictObject({
      enabled: z.literal(true),
      providers: z.array(runtimeAiProviderSchema).min(1).max(32),
      defaultProvider: profileIdSchema,
      applyMode: z.enum(AGENT_APPLY_MODES),
    })
    .refine(
      ({ defaultProvider, providers }) =>
        providers.some(({ id }) => id === defaultProvider) &&
        new Set(providers.map(({ id }) => id)).size === providers.length,
      { message: "Runtime AI provider profiles are inconsistent." },
    ),
]);
const positiveInteger = z.number().int().positive();
const runtimeConfigBaseShape = {
  apiBase: z.literal(SPOTPATCH_API_BASE),
  ai: runtimeAiConfigSchema,
  budget: z.strictObject({
    totalCharacters: positiveInteger,
    domCharacters: positiveInteger,
    cssCharacters: positiveInteger,
    codeCharacters: positiveInteger,
    maxCodeLines: positiveInteger,
    maxComponentDepth: positiveInteger,
  }),
  contextualAsk: z.strictObject({ enabled: z.boolean() }),
  debug: z.boolean(),
  dataFlow: runtimeDataFlowConfigSchema,
  editor: z.enum(SPOTPATCH_EDITOR_PREFERENCES),
  externalAgent: z.strictObject({ enabled: z.boolean() }),
  frameworkVersion: boundedText(64),
  locale: z.enum(SPOTPATCH_LOCALE_PREFERENCES),
  maxTargets: z.number().int().min(1).max(MAX_ANNOTATION_TARGETS),
  redact: z.boolean(),
  sessionId: z
    .string()
    .min(22)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
  sessionToken: z
    .string()
    .min(22)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
  shortcut: boundedText(128),
  spotPatchVersion: boundedText(64),
} as const;

export const runtimeConfigSchema: z.ZodType<SpotPatchRuntimeConfig> =
  z.discriminatedUnion("framework", [
    z.strictObject({
      ...runtimeConfigBaseShape,
      framework: z.literal("vite"),
    }),
    z.strictObject({
      ...runtimeConfigBaseShape,
      bundler: z.enum(SPOTPATCH_NEXT_BUNDLERS),
      framework: z.literal("next"),
      routerKind: z.enum(SPOTPATCH_NEXT_ROUTER_KINDS),
    }),
  ]);

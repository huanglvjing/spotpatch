import {
  resolveOptions,
  type ResolvedSpotPatchOptions,
  type SimpleAiOptions,
  type SpotPatchOptions,
} from "./options.js";
import { resolveProjectValidationChecks } from "./project-validation.js";

export interface ResolveProjectOptionsInput {
  readonly appRoot: string;
  readonly environmentAi?: false | SimpleAiOptions;
  readonly options?: SpotPatchOptions;
  readonly resolveValidationChecks?: typeof resolveProjectValidationChecks;
}

export async function resolveProjectOptions(
  input: ResolveProjectOptionsInput,
): Promise<ResolvedSpotPatchOptions> {
  const userOptions = input.options ?? {};
  const resolved = resolveOptions(userOptions, input.environmentAi);

  if (!userOptions.trustedFastMode || resolved.ai === false) {
    return resolved;
  }

  if (resolved.ai.execution.applyMode === "auto") {
    throw new RangeError(
      "SpotPatch trustedFastMode cannot be combined with applyMode auto.",
    );
  }

  const checks = await (
    input.resolveValidationChecks ?? resolveProjectValidationChecks
  )({
    appRoot: input.appRoot,
    checks: resolved.ai.execution.checks,
    timeoutMs: resolved.ai.execution.limits.checkTimeoutMs,
  });

  if (!Object.values(checks).some((check) => check.required)) {
    throw new RangeError(
      "SpotPatch trustedFastMode requires a configured required check or an available framework-compatible local project check.",
    );
  }

  const ai = Object.freeze({
    ...resolved.ai,
    execution: Object.freeze({
      ...resolved.ai.execution,
      applyMode: "trusted-auto" as const,
      checks,
    }),
  });

  return Object.freeze({ ...resolved, ai });
}

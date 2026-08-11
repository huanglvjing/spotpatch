import type {
  ResolvedAgentCheckDefinition,
  ResolvedAiOptions,
} from "@spotpatch/shared";

import {
  resolveOptions,
  type ResolvedSpotPatchOptions,
  type SimpleAiOptions,
  type SpotPatchOptions,
} from "./options.js";
import { discoverProjectValidationCheck } from "./project-validation.js";

export interface ResolveProjectOptionsInput {
  readonly appRoot: string;
  readonly environmentAi?: false | SimpleAiOptions;
  readonly options?: SpotPatchOptions;
}

function hasRequiredCheck(ai: ResolvedAiOptions): boolean {
  return Object.values(ai.execution.checks).some((check) => check.required);
}

function availableCheckId(
  checks: Readonly<Record<string, ResolvedAgentCheckDefinition>>,
  preferred: string,
): string {
  if (checks[preferred] === undefined) {
    return preferred;
  }

  let suffix = 2;

  while (checks[`${preferred}-${String(suffix)}`] !== undefined) {
    suffix += 1;
  }

  return `${preferred}-${String(suffix)}`;
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

  let checks = resolved.ai.execution.checks;

  if (!hasRequiredCheck(resolved.ai)) {
    const discovered = await discoverProjectValidationCheck({
      appRoot: input.appRoot,
      timeoutMs: resolved.ai.execution.limits.checkTimeoutMs,
    });

    if (discovered === undefined) {
      throw new RangeError(
        "SpotPatch trustedFastMode requires a configured required check or a local TypeScript project with tsconfig.json.",
      );
    }

    const id = availableCheckId(checks, discovered.id);
    checks = Object.freeze({
      ...checks,
      [id]: Object.freeze({ ...discovered, id }),
    });
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

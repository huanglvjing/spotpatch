import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_LIMITS,
  type ResolvedAgentCheckDefinition,
} from "@spotpatch/shared";

import { createTestGitRepository } from "../test-utils/git-repository.js";
import { runConfiguredCheck } from "./check-runner.js";

function check(
  source: Partial<ResolvedAgentCheckDefinition> = {},
): ResolvedAgentCheckDefinition {
  return Object.freeze({
    id: "test",
    label: "Test check",
    command: process.execPath,
    args: Object.freeze(["-e", "process.stdout.write('ok')"]),
    required: true,
    timeoutMs: 2_000,
    ...source,
  });
}

describe("configured check runner", () => {
  it("uses a minimal environment and redacts paths and terminal escapes", async () => {
    const repository = await createTestGitRepository();

    try {
      process.env.SPOTPATCH_SYNTHETIC_SECRET = "must-not-reach-check";
      const script =
        "process.stdout.write(String(process.env.SPOTPATCH_SYNTHETIC_SECRET) + '\\n' + process.cwd() + '\\nBearer synthetic-check-secret\\n' + String.fromCharCode(27) + '[31mred')";
      const result = await runConfiguredCheck({
        check: check({ args: Object.freeze(["-e", script]) }),
        maxOutputCharacters: DEFAULT_AGENT_LIMITS.maxToolOutputCharacters,
        signal: new AbortController().signal,
        worktreeRoot: repository.root,
      });

      expect(result.status).toBe("passed");
      expect(result.output).toContain("undefined");
      expect(result.output).toContain("<workspace>");
      expect(result.output).toContain("red");
      expect(result.output).not.toContain(repository.root);
      expect(result.output).not.toContain("must-not-reach-check");
      expect(result.output).not.toContain("synthetic-check-secret");
      expect(result.output).not.toContain(String.fromCharCode(27));
    } finally {
      delete process.env.SPOTPATCH_SYNTHETIC_SECRET;
      await repository.cleanup();
    }
  });

  it("reports nonzero exits, timeouts, and cancellation", async () => {
    const repository = await createTestGitRepository();

    try {
      const failed = await runConfiguredCheck({
        check: check({ args: Object.freeze(["-e", "process.exit(2)"]) }),
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        worktreeRoot: repository.root,
      });
      const timedOut = await runConfiguredCheck({
        check: check({
          args: Object.freeze(["-e", "setTimeout(() => {}, 10_000)"]),
          timeoutMs: 20,
        }),
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        worktreeRoot: repository.root,
      });
      const controller = new AbortController();
      controller.abort();
      const cancelled = await runConfiguredCheck({
        check: check(),
        maxOutputCharacters: 100,
        signal: controller.signal,
        worktreeRoot: repository.root,
      });

      expect(failed.status).toBe("failed");
      expect(timedOut.status).toBe("timed-out");
      expect(cancelled.status).toBe("cancelled");
    } finally {
      await repository.cleanup();
    }
  });
});

import {
  ERROR_CODES,
  SpotPatchError,
  type AgentCapabilitySnapshot,
  type AgentApplyMode,
  type AgentJobCreateRequest,
  type AgentJobResult,
  type ErrorCode,
  type ResolvedAiOptions,
  type SpotAnnotation,
} from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { resolveOptions } from "../options.js";
import { createAgentJobManager } from "./job-manager.js";

const TEST_ENVIRONMENT = Object.freeze({
  SPOTPATCH_TEST_API_KEY: "sk-private-never-serialize",
});

const annotation = Object.freeze({
  schemaVersion: 3,
  id: "annotation-id",
  locale: "en-US",
  page: Object.freeze({
    url: "http://localhost:5173/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  }),
  targets: Object.freeze([
    Object.freeze({
      instruction: "Make the selected button clearer.",
      source: Object.freeze({
        fileId: "source-id",
        relativePath: "src/App.tsx",
        line: 12,
        column: 5,
        origin: "jsx-host",
        confidence: "exact",
      }),
      react: Object.freeze({
        supported: true,
        componentName: "App",
        componentStack: Object.freeze(["App"]),
      }),
      element: Object.freeze({
        tagName: "button",
        selector: "button.primary",
        sanitizedHtml: '<button class="primary">Save</button>',
        textPreview: "Save",
        rect: Object.freeze({ x: 10, y: 20, width: 100, height: 40 }),
      }),
      styles: Object.freeze({
        classNames: Object.freeze(["primary"]),
        matchedRules: Object.freeze([]),
        computed: Object.freeze({ display: "block" }),
        warnings: Object.freeze([]),
      }),
      warnings: Object.freeze([]),
    }),
  ]),
  createdAt: "2026-08-07T00:00:00.000Z",
}) satisfies SpotAnnotation;

function resolveAi(applyMode: AgentApplyMode = "review"): ResolvedAiOptions {
  const ai = resolveOptions({
    ai: {
      providers: {
        relay: {
          type: "openai-compatible",
          label: "Trusted Relay",
          protocol: "responses",
          baseURL: "https://relay.example/v1",
          apiKeyEnv: "SPOTPATCH_TEST_API_KEY",
          models: {
            coder: { label: "Coding Model", model: "provider-model-v1" },
          },
          defaultModel: "coder",
        },
      },
      defaultProvider: "relay",
      execution: {
        applyMode,
        checks:
          applyMode === "review"
            ? {}
            : {
                typecheck: {
                  label: "Typecheck",
                  command: "node",
                  args: ["--version"],
                  required: true,
                },
              },
      },
    },
  }).ai;

  if (ai === false) {
    throw new Error("Expected AI configuration.");
  }

  return ai;
}

function jobRequest(trustedFastModeConsent = false): AgentJobCreateRequest {
  return Object.freeze({
    annotation,
    providerProfileId: "relay",
    modelProfileId: "coder",
    providerDataConsent: true,
    ...(trustedFastModeConsent ? { trustedFastModeConsent: true as const } : {}),
    workingTreeMode: "require-clean",
  });
}

function resultFor(jobId: string, validationPassed = true): AgentJobResult {
  return Object.freeze({
    jobId,
    summary: validationPassed ? "Updated the selected button." : "Check failed.",
    diff: [
      "diff --git a/src/App.tsx b/src/App.tsx",
      "--- a/src/App.tsx",
      "+++ b/src/App.tsx",
      "@@ -1 +1 @@",
      "-Save",
      "+Save changes",
      "",
    ].join("\n"),
    files: Object.freeze([
      Object.freeze({
        relativePath: "src/App.tsx",
        kind: "modified" as const,
        additions: 1,
        deletions: 1,
      }),
    ]),
    checks: Object.freeze(
      validationPassed
        ? []
        : [
            Object.freeze({
              checkId: "typecheck",
              label: "Typecheck",
              status: "failed" as const,
              durationMs: 12,
              output: "Type error",
            }),
          ],
    ),
  });
}

function capabilitySnapshot(): AgentCapabilitySnapshot {
  return Object.freeze({
    providerProfileId: "relay",
    providerLabel: "Trusted Relay",
    modelProfileId: "coder",
    modelLabel: "Coding Model",
    protocol: "responses",
    state: "agent-ready",
    authenticated: true,
    modelAvailable: true,
    toolCalling: true,
    toolResultContinuation: true,
    streaming: true,
    checkedAt: "2026-08-07T00:00:01.000Z",
  });
}

function monotonicClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 7, 7, 0, 0, tick)).toISOString();
  };
}

async function waitForStatus(
  manager: ReturnType<typeof createAgentJobManager>,
  jobId: string,
  status: string,
): Promise<void> {
  await vi.waitFor(() => {
    expect(manager.result(jobId).snapshot.status).toBe(status);
  });
}

function expectSpotPatchError(run: () => unknown, code: ErrorCode): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SpotPatchError);
    expect((error as SpotPatchError).code).toBe(code);
    return;
  }

  throw new Error("Expected a SpotPatchError.");
}

describe("Agent job manager", () => {
  it("probes an allowlisted provider once and exposes only public capability data", async () => {
    const probeCapability = vi.fn(() => Promise.resolve(capabilitySnapshot()));
    const manager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: { probeCapability },
    });
    const request = Object.freeze({
      providerProfileId: "relay",
      modelProfileId: "coder",
    });

    const first = await manager.probe(request, new AbortController().signal);
    const second = await manager.probe(request, new AbortController().signal);
    const serialized = JSON.stringify([first, second]);

    expect(probeCapability).toHaveBeenCalledOnce();
    expect(first.state).toBe("agent-ready");
    expect(serialized).not.toContain("relay.example");
    expect(serialized).not.toContain("SPOTPATCH_TEST_API_KEY");
    expect(serialized).not.toContain(TEST_ENVIRONMENT.SPOTPATCH_TEST_API_KEY);
    await manager.close();
  });

  it("runs a review job directly through events, result, Apply, and Revert", async () => {
    const applyChange = vi.fn(() => Promise.resolve());
    const probeCapability = vi.fn(() => Promise.resolve(capabilitySnapshot()));
    const revertChange = vi.fn(() => Promise.resolve());
    const manager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        applyChange,
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: resultFor(jobId),
              validationPassed: true,
              autoApplyEligible: false,
            }),
          ),
        now: monotonicClock(),
        probeCapability,
        revertChange,
      },
    });

    const created = manager.create(jobRequest());
    await waitForStatus(manager, created.jobId, "awaiting-review");

    const beforeApply = manager.result(created.jobId);
    const events = manager.events(created.jobId);
    expect(beforeApply.snapshot.canApply).toBe(true);
    expect(probeCapability).not.toHaveBeenCalled();
    expect(beforeApply.result?.files[0]?.relativePath).toBe("src/App.tsx");
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.some((event) => event.type === "result-ready")).toBe(true);

    const applied = await manager.apply(created.jobId);
    expect(applied).toMatchObject({ status: "applied", canRevert: true });
    expect(applyChange).toHaveBeenCalledOnce();

    const reverted = await manager.revert(created.jobId);
    expect(reverted).toMatchObject({ status: "reverted", canRevert: false });
    expect(revertChange).toHaveBeenCalledOnce();
    await manager.close();
  });

  it("rejects concurrent write jobs without creating an implicit queue", async () => {
    const manager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: resultFor(jobId),
              validationPassed: true,
              autoApplyEligible: false,
            }),
          ),
        probeCapability: () => Promise.resolve(capabilitySnapshot()),
      },
    });

    const first = manager.create(jobRequest());

    expectSpotPatchError(() => manager.create(jobRequest()), ERROR_CODES.AGENT_BUSY);
    await waitForStatus(manager, first.jobId, "awaiting-review");
    expectSpotPatchError(() => manager.create(jobRequest()), ERROR_CODES.AGENT_BUSY);
    manager.cancel(first.jobId);
    await manager.close();
  });

  it("propagates cancellation and never exposes private failure causes", async () => {
    const manager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                reject(
                  new SpotPatchError(ERROR_CODES.AGENT_CANCELLED, undefined, {
                    cause: new Error("secret cause"),
                  }),
                );
              },
              { once: true },
            );
          }),
        probeCapability: () => Promise.resolve(capabilitySnapshot()),
      },
    });
    const created = manager.create(jobRequest());
    await waitForStatus(manager, created.jobId, "preparing");

    const cancelling = manager.cancel(created.jobId);
    expect(cancelling.status).toBe("cancelling");
    await waitForStatus(manager, created.jobId, "cancelled");

    const serialized = JSON.stringify(manager.events(created.jobId));
    expect(serialized).not.toContain("secret cause");
    expect(serialized).not.toContain(TEST_ENVIRONMENT.SPOTPATCH_TEST_API_KEY);
    await manager.close();
  });

  it("retains a failed validation result but never enables Apply", async () => {
    const manager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: resultFor(jobId, false),
              validationPassed: false,
              autoApplyEligible: false,
            }),
          ),
        probeCapability: () => Promise.resolve(capabilitySnapshot()),
      },
    });
    const created = manager.create(jobRequest());
    await waitForStatus(manager, created.jobId, "failed");

    const response = manager.result(created.jobId);
    expect(response.snapshot).toMatchObject({
      canApply: false,
      errorCode: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(response.result?.checks[0]?.status).toBe("failed");
    await expect(manager.apply(created.jobId)).rejects.toMatchObject({
      code: ERROR_CODES.PATCH_REJECTED,
    });
    await manager.close();
  });

  it("auto-applies only an engine-approved change", async () => {
    const applyChange = vi.fn(() => Promise.resolve());
    const manager = createAgentJobManager({
      ai: resolveAi("auto"),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        applyChange,
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: resultFor(jobId),
              validationPassed: true,
              autoApplyEligible: true,
            }),
          ),
        probeCapability: () => Promise.resolve(capabilitySnapshot()),
      },
    });
    const created = manager.create(jobRequest());
    await waitForStatus(manager, created.jobId, "applied");

    expect(applyChange).toHaveBeenCalledOnce();
    expect(manager.result(created.jobId).snapshot.canRevert).toBe(true);
    await manager.close();
  });

  it("directly applies a validated trusted fast-mode change", async () => {
    const applyChange = vi.fn(() => Promise.resolve());
    const manager = createAgentJobManager({
      ai: resolveAi("trusted-auto"),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        applyChange,
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: resultFor(jobId),
              validationPassed: true,
              autoApplyEligible: false,
            }),
          ),
      },
    });
    const created = manager.create(jobRequest(true));
    await waitForStatus(manager, created.jobId, "applied");

    expect(applyChange).toHaveBeenCalledOnce();
    expect(manager.result(created.jobId).snapshot.canApply).toBe(false);
    expect(manager.result(created.jobId).snapshot.canRevert).toBe(true);
    await manager.close();
  });

  it("requires trusted fast-mode consent to match the server configuration", async () => {
    const trustedManager = createAgentJobManager({
      ai: resolveAi("trusted-auto"),
      root: "/project",
      environment: TEST_ENVIRONMENT,
    });
    const reviewManager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
    });

    expectSpotPatchError(
      () => trustedManager.create(jobRequest()),
      ERROR_CODES.INVALID_REQUEST,
    );
    expectSpotPatchError(
      () => reviewManager.create(jobRequest(true)),
      ERROR_CODES.INVALID_REQUEST,
    );
    await Promise.all([trustedManager.close(), reviewManager.close()]);
  });

  it("allows the page to choose review mode under a trusted fast policy", async () => {
    const manager = createAgentJobManager({
      ai: resolveAi("trusted-auto"),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: ({ jobId }) =>
          Promise.resolve(
            Object.freeze({
              kind: "prepared-agent-change" as const,
              result: resultFor(jobId),
              validationPassed: true,
              autoApplyEligible: false,
            }),
          ),
      },
    });
    const created = manager.create(
      Object.freeze({ ...jobRequest(), applyMode: "review" as const }),
    );
    await waitForStatus(manager, created.jobId, "awaiting-review");

    expect(manager.result(created.jobId).snapshot.canApply).toBe(true);
    await manager.close();
  });

  it("surfaces Apply and Revert conflicts without claiming a successful write", async () => {
    const createReviewManager = (
      applyChange: () => Promise<void>,
      revertChange: () => Promise<void>,
    ) =>
      createAgentJobManager({
        ai: resolveAi(),
        root: "/project",
        environment: TEST_ENVIRONMENT,
        dependencies: {
          applyChange,
          createJobId: () => "0123456789abcdefghijklmn",
          executeChange: ({ jobId }) =>
            Promise.resolve(
              Object.freeze({
                kind: "prepared-agent-change" as const,
                result: resultFor(jobId),
                validationPassed: true,
                autoApplyEligible: false,
              }),
            ),
          probeCapability: () => Promise.resolve(capabilitySnapshot()),
          revertChange,
        },
      });
    const applyConflictManager = createReviewManager(
      () => Promise.reject(new SpotPatchError(ERROR_CODES.APPLY_CONFLICT)),
      () => Promise.resolve(),
    );
    const first = applyConflictManager.create(jobRequest());
    await waitForStatus(applyConflictManager, first.jobId, "awaiting-review");

    await expect(applyConflictManager.apply(first.jobId)).rejects.toMatchObject({
      code: ERROR_CODES.APPLY_CONFLICT,
    });
    expect(applyConflictManager.result(first.jobId).snapshot).toMatchObject({
      status: "failed",
      canApply: false,
      errorCode: ERROR_CODES.APPLY_CONFLICT,
    });
    await applyConflictManager.close();

    const revertConflictManager = createReviewManager(
      () => Promise.resolve(),
      () => Promise.reject(new SpotPatchError(ERROR_CODES.APPLY_CONFLICT)),
    );
    const second = revertConflictManager.create(jobRequest());
    await waitForStatus(revertConflictManager, second.jobId, "awaiting-review");
    await revertConflictManager.apply(second.jobId);

    await expect(revertConflictManager.revert(second.jobId)).rejects.toMatchObject({
      code: ERROR_CODES.APPLY_CONFLICT,
    });
    expect(revertConflictManager.result(second.jobId).snapshot).toMatchObject({
      status: "applied",
      canRevert: true,
      errorCode: ERROR_CODES.APPLY_CONFLICT,
    });
    await revertConflictManager.close();
  });

  it("maps unexpected execution failures to a stable public error", async () => {
    const manager = createAgentJobManager({
      ai: resolveAi(),
      root: "/project",
      environment: TEST_ENVIRONMENT,
      dependencies: {
        createJobId: () => "0123456789abcdefghijklmn",
        executeChange: () =>
          Promise.reject(
            new Error(`execution ${TEST_ENVIRONMENT.SPOTPATCH_TEST_API_KEY} failed`),
          ),
      },
    });
    const created = manager.create(jobRequest());
    await waitForStatus(manager, created.jobId, "failed");

    const serialized = JSON.stringify({
      events: manager.events(created.jobId),
      result: manager.result(created.jobId),
    });
    expect(serialized).toContain(ERROR_CODES.INTERNAL_ERROR);
    expect(serialized).not.toContain(TEST_ENVIRONMENT.SPOTPATCH_TEST_API_KEY);
    expect(serialized).not.toContain("relay.example");
    await manager.close();
  });
});

import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  SpotPatchError,
  type ExternalHandoffPublishRequest,
  type SpotAnnotation,
} from "@spotpatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExternalHandoffService,
  type ExternalHandoffService,
} from "./service.js";

let root = "";
let runtimeRoot = "";
let service: ExternalHandoffService | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "spotpatch-handoff-service-"));
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "spotpatch-runtime-service-"));
  await chmod(runtimeRoot, 0o700);
  vi.stubEnv("XDG_RUNTIME_DIR", runtimeRoot);
  service = createExternalHandoffService({
    framework: "vite",
    root,
    sessionId: "0123456789abcdef012345",
  });
  await service.start();
});

afterEach(async () => {
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(runtimeRoot, { recursive: true, force: true }),
  ]);
});

function annotation(
  instruction = "Update it.",
): ExternalHandoffPublishRequest["annotation"] {
  return {
    schemaVersion: 3,
    id: "annotation-id",
    locale: "en-US",
    page: {
      url: "http://127.0.0.1:5173/",
      pathname: "/",
      title: "Fixture",
      viewportWidth: 100,
      viewportHeight: 100,
      devicePixelRatio: 1,
    },
    targets: [
      {
        instruction,
        source: { origin: "none", confidence: "unknown" },
        react: { supported: false, componentStack: [] },
        element: {
          tagName: "div",
          selector: "div",
          sanitizedHtml: "<div></div>",
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
        styles: { classNames: [], matchedRules: [], computed: {}, warnings: [] },
        warnings: [],
      },
    ],
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

describe("external handoff service", () => {
  it("coalesces concurrent canonical request replays before authorization", async () => {
    if (service === undefined) throw new Error("Missing service.");
    let releaseAuthorization: (() => void) | undefined;
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const authorize = vi.fn(
      async (
        value: ExternalHandoffPublishRequest["annotation"],
      ): Promise<SpotAnnotation> => {
        await authorizationGate;
        return value as unknown as SpotAnnotation;
      },
    );
    const request = {
      requestId: "concurrentrequest01234567890123456789",
      annotation: annotation(),
    } satisfies ExternalHandoffPublishRequest;

    const first = service.publish(request, authorize);
    const replay = service.publish(request, authorize);
    await expect(
      service.publish(
        { ...request, annotation: annotation("Different request") },
        authorize,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.HANDOFF_VALIDATION_FAILED });
    releaseAuthorization?.();

    const [firstResult, replayResult] = await Promise.all([first, replay]);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(firstResult).toMatchObject({
      replayed: false,
      handoff: { revision: 1 },
      delivery: { mode: "inbox" },
    });
    expect(replayResult).toEqual({ ...firstResult, replayed: true });
    await expect(service.publish(request, authorize)).resolves.toEqual(replayResult);
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it("does not commit a revision when authorization fails", async () => {
    if (service === undefined) throw new Error("Missing service.");
    const request = {
      requestId: "failedauthorization012345678901234567",
      annotation: annotation(),
    } satisfies ExternalHandoffPublishRequest;

    await expect(
      service.publish(request, () =>
        Promise.reject(new SpotPatchError(ERROR_CODES.HANDOFF_SOURCE_STALE)),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.HANDOFF_SOURCE_STALE });
    try {
      service.status();
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: ERROR_CODES.HANDOFF_NOT_FOUND });
      return;
    }

    throw new Error("Expected the empty service status to fail.");
  });
});

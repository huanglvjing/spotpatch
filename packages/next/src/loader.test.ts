import { afterEach, describe, expect, it, vi } from "vitest";

import { NEXT_ENVIRONMENT_KEYS } from "./internal/constants.js";
import spotPatchNextLoader from "./loader.js";

type LoaderCallback = (
  error: Error | null,
  source?: string,
  sourceMap?: unknown,
  metadata?: unknown,
) => void;

interface LoaderInvocation {
  readonly callback: ReturnType<typeof vi.fn<LoaderCallback>>;
  readonly completion: Promise<Parameters<LoaderCallback>>;
  readonly emitWarning: ReturnType<typeof vi.fn<(warning: Error) => void>>;
  readonly cacheable: ReturnType<typeof vi.fn<(cacheable: boolean) => void>>;
}

function configureEnvironment(epoch: string): void {
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.appRoot, "/project");
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.bundler, "webpack");
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.internalOrigin, "http://127.0.0.1:43121");
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.internalSecret, "internal-loader-test-secret");
  vi.stubEnv(NEXT_ENVIRONMENT_KEYS.registryEpoch, epoch);
}

function invokeLoader(input: {
  readonly epoch: string;
  readonly inputMap?: unknown;
  readonly metadata?: unknown;
  readonly resourcePath: string;
  readonly source: string;
}): LoaderInvocation {
  let resolveCompletion: (value: Parameters<LoaderCallback>) => void = () => {
    throw new Error("The Loader completion promise was not initialized.");
  };
  const completion = new Promise<Parameters<LoaderCallback>>((resolve) => {
    resolveCompletion = resolve;
  });
  const callback = vi.fn<LoaderCallback>((...arguments_) => {
    resolveCompletion(arguments_);
  });
  const cacheable = vi.fn<(cacheable: boolean) => void>();
  const emitWarning = vi.fn<(warning: Error) => void>();
  const context = {
    resourcePath: input.resourcePath,
    async: () => callback,
    cacheable,
    emitWarning,
    getOptions: () => ({ registryEpoch: input.epoch }),
  };

  spotPatchNextLoader.call(context, input.source, input.inputMap, input.metadata);
  return Object.freeze({ callback, completion, emitWarning, cacheable });
}

function registrationResponse(epoch: string, fileId: string): Response {
  const body = JSON.stringify({ epoch, fileId });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Length": String(Buffer.byteLength(body)),
      "Content-Type": "application/json",
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Next source Loader", () => {
  it("registers once, injects deterministic markers, and reuses its epoch cache", async () => {
    const epoch = "epoch_loader_cache_0001";
    const fileId = "file_loader_cache_01";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(registrationResponse(epoch, fileId));
    vi.stubGlobal("fetch", fetchMock);
    configureEnvironment(epoch);
    const input = {
      epoch,
      metadata: Object.freeze({ fixture: true }),
      resourcePath: "/project/app/page.tsx",
      source: "export const view = <main>Hello</main>;",
    };
    const first = invokeLoader(input);
    const firstResult = await first.completion;
    const second = invokeLoader(input);
    const secondResult = await second.completion;

    expect(first.cacheable).toHaveBeenCalledWith(true);
    expect(first.callback).toHaveBeenCalledTimes(1);
    expect(second.callback).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult[0]).toBeNull();
    expect(firstResult[1]).toContain(`data-spotpatch-source="${fileId}:1:`);
    expect(secondResult[1]).toBe(firstResult[1]);
    expect(firstResult[2]).toMatchObject({
      sources: ["app/page.tsx"],
      sourcesContent: [input.source],
    });
    expect(firstResult[3]).toBe(input.metadata);
    expect(first.emitWarning).not.toHaveBeenCalled();
  });

  it("skips modules without JSX without touching registration transport", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const inputMap = Object.freeze({ version: 3 });
    const metadata = Object.freeze({ fixture: "plain" });
    const invocation = invokeLoader({
      epoch: "epoch_loader_plain_0001",
      inputMap,
      metadata,
      resourcePath: "/project/app/plain.ts",
      source: "export const value = 1;",
    });

    await expect(invocation.completion).resolves.toEqual([
      null,
      "export const value = 1;",
      inputMap,
      metadata,
    ]);
    expect(invocation.callback).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open before registration when an upstream source map is present", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const inputMap = Object.freeze({ version: 3 });
    const invocation = invokeLoader({
      epoch: "epoch_loader_map_00001",
      inputMap,
      resourcePath: "/project/app/map.tsx",
      source: "export const view = <div />;",
    });

    await expect(invocation.completion).resolves.toEqual([
      null,
      "export const view = <div />;",
      inputMap,
      undefined,
    ]);
    expect(invocation.callback).toHaveBeenCalledTimes(1);
    expect(invocation.emitWarning.mock.calls[0]?.[0].message).toContain(
      "upstream-source-map-unsupported",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open exactly once when source registration is unavailable", async () => {
    const epoch = "epoch_loader_failure_001";
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    configureEnvironment(epoch);
    const source = "export const view = <section />;";
    const invocation = invokeLoader({
      epoch,
      resourcePath: "/project/app/failure.tsx",
      source,
    });

    await expect(invocation.completion).resolves.toEqual([
      null,
      source,
      undefined,
      undefined,
    ]);
    expect(invocation.callback).toHaveBeenCalledTimes(1);
    expect(invocation.emitWarning.mock.calls[0]?.[0].message).toContain(
      "request-failed",
    );
  });
});

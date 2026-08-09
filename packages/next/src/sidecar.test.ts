import { afterEach, describe, expect, it } from "vitest";

import { resolveOptions } from "@spotpatch/dev-server";
import { SPOTPATCH_ENDPOINTS, runtimeConfigSchema } from "@spotpatch/shared";

import { createNextSidecar, type NextSidecar } from "./sidecar.js";

const configurationSecret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";
const internalSecret = "abcdefghijklmnopqrstuvwxyz012345ABCDEFGH";
const registryEpoch = "0123456789abcdefghijklmn";
const publicOrigin = "http://127.0.0.1:3000";

let sidecar: NextSidecar | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe("Next Sidecar", () => {
  it("activates with a schema-normalized runtime configuration", async () => {
    sidecar = await createNextSidecar({
      configuration: {
        configurationSecret,
        onConfiguration: () => Promise.resolve(undefined),
      },
    });
    await sidecar.activate({
      appRoot: process.cwd(),
      bundler: "turbopack",
      credentials: Object.freeze({}),
      internalSecret,
      nextVersion: "16.3.0",
      options: resolveOptions(),
      projectRoot: process.cwd(),
      publicOrigin,
      registryEpoch,
      routerKind: "app",
    });
    const response = await fetch(
      new URL(SPOTPATCH_ENDPOINTS.bootstrap, sidecar.origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: publicOrigin,
          "Sec-Fetch-Site": "same-origin",
        },
        body: "{}",
      },
    );
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({ ok: true });

    if (typeof payload !== "object" || payload === null || !("data" in payload)) {
      throw new TypeError("Expected a SpotPatch bootstrap payload.");
    }

    expect(runtimeConfigSchema.safeParse(payload.data).success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import {
  createProviderCredential,
  readProviderCredential,
  resolveProviderCredential,
} from "./provider-credential.js";

describe("provider credentials", () => {
  it("resolves a credential without exposing its value through serialization", () => {
    const key = "synthetic-provider-credential-do-not-use";
    const credential = resolveProviderCredential("SPOTPATCH_TEST_KEY", {
      SPOTPATCH_TEST_KEY: key,
    });

    expect(readProviderCredential(credential)).toBe(key);
    expect(JSON.stringify({ credential })).not.toContain(key);
    expect(Object.keys(credential)).toEqual(["kind"]);
    expect(Object.isFrozen(credential)).toBe(true);
  });

  it.each([undefined, "", "   "])(
    "rejects a missing or blank credential: %s",
    (value) => {
      let error: unknown;

      try {
        if (value === undefined) {
          resolveProviderCredential("SPOTPATCH_TEST_KEY", {});
        } else {
          createProviderCredential(value);
        }
      } catch (caught: unknown) {
        error = caught;
      }

      expect(error).toBeInstanceOf(SpotPatchError);
      expect(error).toMatchObject({ code: ERROR_CODES.PROVIDER_NOT_CONFIGURED });
    },
  );

  it("rejects a forged credential object", () => {
    expect(() => readProviderCredential({ kind: "provider-credential" })).toThrowError(
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
    );
  });
});

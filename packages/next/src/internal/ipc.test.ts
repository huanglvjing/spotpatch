import { describe, expect, it } from "vitest";

import {
  resolveOptions,
  serializeResolvedSpotPatchOptions,
} from "@spotpatch/dev-server";

import { NEXT_IPC_PROTOCOL_VERSION } from "./constants.js";
import {
  parseNextConfigureAck,
  parseNextConfigureMessage,
  type NextConfigureMessage,
} from "./ipc.js";

const nonce = "0123456789abcdefghijklmn";
const requestId = "zyxwvutsrqponmlkjihgfedc";

function message(): NextConfigureMessage {
  return Object.freeze({
    appRoot: "/project",
    credentials: Object.freeze({}),
    nonce,
    options: serializeResolvedSpotPatchOptions(resolveOptions()),
    protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
    requestId,
    type: "spotpatch:next:configure",
  });
}

describe("Next private IPC", () => {
  it("parses a strict configure message and correlated acknowledgement", () => {
    expect(parseNextConfigureMessage(message())).toMatchObject({
      appRoot: "/project",
      nonce,
      requestId,
    });
    expect(
      parseNextConfigureAck({
        nonce,
        ok: true,
        protocolVersion: NEXT_IPC_PROTOCOL_VERSION,
        requestId,
        type: "spotpatch:next:configure-ack",
      }),
    ).toMatchObject({ ok: true, requestId });
  });

  it("rejects unknown fields, malformed identities, and credential injection", () => {
    expect(() => parseNextConfigureMessage({ ...message(), extra: true })).toThrow(
      TypeError,
    );
    expect(() => parseNextConfigureMessage({ ...message(), nonce: "short" })).toThrow(
      TypeError,
    );
    expect(() =>
      parseNextConfigureMessage({
        ...message(),
        credentials: { PATH: "/attacker/bin", extra: 1 },
      }),
    ).toThrow(TypeError);
  });
});

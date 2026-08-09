import { randomBytes } from "node:crypto";

export interface SpotPatchSession {
  readonly token: string;
}

export function createSession(): SpotPatchSession {
  return Object.freeze({
    token: randomBytes(16).toString("base64url"),
  });
}

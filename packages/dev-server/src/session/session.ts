import { randomBytes } from "node:crypto";

export interface SpotPatchSession {
  readonly id: string;
  readonly token: string;
}

export function createSession(): SpotPatchSession {
  return Object.freeze({
    id: randomBytes(16).toString("base64url"),
    token: randomBytes(16).toString("base64url"),
  });
}

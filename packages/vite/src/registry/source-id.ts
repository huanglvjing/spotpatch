import { randomBytes } from "node:crypto";

const SOURCE_ID_BYTES = 8;

export type SourceIdFactory = () => string;

export const createRandomSourceId: SourceIdFactory = () =>
  randomBytes(SOURCE_ID_BYTES).toString("base64url");

import { createHash } from "node:crypto";

import type { ExternalHandoffPublishRequest } from "@spotpatch/shared";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }

  throw new TypeError("Unsupported JSON value.");
}

export function fingerprintExternalHandoffAnnotation(
  annotation: ExternalHandoffPublishRequest["annotation"],
): string {
  return createHash("sha256").update(canonicalJson(annotation)).digest("hex");
}

import { createHash } from "node:crypto";

export function createDataFlowAnchorId(
  kind: string,
  relativePath: string,
  sourceVersion: string,
  position: number,
  discriminator = "",
): string {
  const digest = createHash("sha256")
    .update("spotpatch-analyzer-v1\0")
    .update(kind)
    .update("\0")
    .update(relativePath)
    .update("\0")
    .update(sourceVersion)
    .update("\0")
    .update(String(position))
    .update("\0")
    .update(discriminator)
    .digest("base64url")
    .slice(0, 22);

  return `${kind}_${digest}`;
}

export function createDataFlowSourceVersion(code: string): string {
  return `source_${createHash("sha256").update(code).digest("base64url").slice(0, 22)}`;
}

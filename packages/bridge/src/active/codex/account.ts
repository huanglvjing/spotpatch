import { CODEX_ADAPTER_ERROR_CODES, CodexAdapterError } from "./errors.js";

export type CodexAuthReadiness = "authenticated" | "auth-not-required" | "signed-out";

/**
 * Parses an `account/read` response. Codex adds fields to this response across
 * releases (0.156 added `workspaceRouting`), and the supported range is open
 * ended, so only the fields SpotPatch relies on are validated and additions
 * are ignored.
 */
export function parseCodexAuthReadiness(value: unknown): CodexAuthReadiness {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  const account: unknown = Reflect.get(value, "account");
  const requiresOpenaiAuth: unknown = Reflect.get(value, "requiresOpenaiAuth");
  if (
    typeof requiresOpenaiAuth !== "boolean" ||
    (account !== null && (typeof account !== "object" || Array.isArray(account)))
  ) {
    throw new CodexAdapterError(CODEX_ADAPTER_ERROR_CODES.PROTOCOL);
  }
  if (account !== null) return "authenticated";
  return requiresOpenaiAuth ? "signed-out" : "auth-not-required";
}

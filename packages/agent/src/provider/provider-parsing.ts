import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import type { ProviderToolCall, ProviderToolResult } from "./provider-types.js";

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonRecord(value: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  if (!isRecord(parsed)) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  return parsed;
}

export function parseToolArguments(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") {
    throw new SpotPatchError(ERROR_CODES.TOOL_ARGUMENTS_INVALID);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SpotPatchError(ERROR_CODES.TOOL_ARGUMENTS_INVALID);
  }

  if (!isRecord(parsed)) {
    throw new SpotPatchError(ERROR_CODES.TOOL_ARGUMENTS_INVALID);
  }

  return parsed;
}

export function assertUniqueToolCallIds(calls: readonly ProviderToolCall[]): void {
  const ids = new Set<string>();

  for (const call of calls) {
    if (ids.has(call.id)) {
      throw new SpotPatchError(ERROR_CODES.TOOL_CALL_ID_CONFLICT);
    }

    ids.add(call.id);
  }
}

export function requireString(
  record: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }

  return value;
}

export function validateToolResults(
  pendingCalls: readonly ProviderToolCall[],
  results: readonly ProviderToolResult[] | undefined,
): readonly ProviderToolResult[] {
  assertUniqueToolCallIds(pendingCalls);

  if (pendingCalls.length === 0) {
    if (results !== undefined && results.length > 0) {
      throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
    }

    return Object.freeze([]);
  }

  if (results?.length !== pendingCalls.length) {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }

  const pendingIds = new Set(pendingCalls.map((call) => call.id));
  const resultIds = new Set(results.map((result) => result.toolCallId));

  if (
    resultIds.size !== results.length ||
    resultIds.size !== pendingIds.size ||
    [...pendingIds].some((id) => !resultIds.has(id))
  ) {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }

  return results;
}

export function jsonStringifyToolOutput(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }

  try {
    return JSON.stringify(value);
  } catch {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }
}

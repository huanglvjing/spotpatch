import { EXTERNAL_AGENT_CONTROL_LIMITS } from "@spotpatch/shared";

const MAXIMUM_MODEL_PAGES = 8;
const MODEL_PAGE_SIZE = 100;

export interface CodexModel {
  readonly model: string;
  readonly isDefault: boolean;
  readonly reasoningEffort?: string;
}

/** Read the whole visible catalog before selecting, including defaults on later pages. */
export async function readCodexModelCatalog(options: {
  readonly request: (params: {
    cursor: string | null;
    limit: number;
    includeHidden: false;
  }) => Promise<unknown>;
  readonly protocolError: () => Error;
  readonly unavailableError: () => Error;
  readonly preferredReasoningEffort?: string;
  readonly maximumModels?: number;
  readonly maximumModelCharacters?: number;
}): Promise<readonly CodexModel[]> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  const catalog = new Map<string, CodexModel>();
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  for (let page = 0; page < MAXIMUM_MODEL_PAGES; page += 1) {
    const value = await options.request({
      cursor,
      limit: MODEL_PAGE_SIZE,
      includeHidden: false,
    });
    if (
      !record(value) ||
      !Array.isArray(value.data) ||
      value.data.length > MODEL_PAGE_SIZE ||
      (value.nextCursor !== null &&
        (typeof value.nextCursor !== "string" || value.nextCursor.length === 0))
    ) {
      throw options.protocolError();
    }
    for (const item of value.data) {
      if (
        !record(item) ||
        typeof item.model !== "string" ||
        item.model.length === 0 ||
        item.model.length >
          (options.maximumModelCharacters ??
            EXTERNAL_AGENT_CONTROL_LIMITS.maximumModelCharacters) ||
        item.model.trim() !== item.model ||
        typeof item.isDefault !== "boolean" ||
        (item.supportedReasoningEfforts !== undefined &&
          !Array.isArray(item.supportedReasoningEfforts))
      ) {
        throw options.protocolError();
      }
      const preferred = options.preferredReasoningEffort;
      const supportsPreferred =
        preferred !== undefined &&
        Array.isArray(item.supportedReasoningEfforts) &&
        item.supportedReasoningEfforts.some(
          (effort: unknown) => record(effort) && effort.reasoningEffort === preferred,
        );
      const existing = catalog.get(item.model);
      catalog.set(
        item.model,
        Object.freeze({
          model: item.model,
          isDefault: item.isDefault || existing?.isDefault === true,
          ...(supportsPreferred ? { reasoningEffort: preferred } : {}),
        }),
      );
    }
    if (
      catalog.size >
      (options.maximumModels ?? EXTERNAL_AGENT_CONTROL_LIMITS.maximumModels)
    )
      throw options.protocolError();
    if (value.nextCursor === null) {
      if (catalog.size === 0) throw options.unavailableError();
      return Object.freeze([...catalog.values()]);
    }
    if (seen.has(value.nextCursor)) throw options.protocolError();
    seen.add(value.nextCursor);
    cursor = value.nextCursor;
  }
  throw options.protocolError();
}

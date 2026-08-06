export const SPOTPATCH_API_BASE = "/__spotpatch/v1" as const;
export const SPOTPATCH_TOKEN_HEADER = "X-SpotPatch-Token" as const;

export const SPOTPATCH_ENDPOINTS = Object.freeze({
  sourceContext: `${SPOTPATCH_API_BASE}/source-context`,
  openEditor: `${SPOTPATCH_API_BASE}/open-editor`,
});

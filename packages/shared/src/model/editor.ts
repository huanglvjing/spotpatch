export const SPOTPATCH_EDITOR_PREFERENCES = ["auto", "vscode", "cursor"] as const;

export type SpotPatchEditorPreference = (typeof SPOTPATCH_EDITOR_PREFERENCES)[number];

export interface EditorOpenResult {
  readonly editor: SpotPatchEditorPreference;
}

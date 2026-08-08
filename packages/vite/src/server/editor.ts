import type { SpotPatchEditorPreference } from "@spotpatch/shared";
import launchEditor from "launch-editor";

const EDITOR_STARTUP_GRACE_MS = 150;

export type EditorLauncher = (
  target: string,
  editor: SpotPatchEditorPreference,
) => Promise<void>;

function editorCommand(editor: SpotPatchEditorPreference): string | undefined {
  if (editor === "vscode") {
    return "code";
  }

  if (editor === "cursor") {
    return "cursor";
  }

  return undefined;
}

export const launchConfiguredEditor: EditorLauncher = (target, editor) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const startupTimer = setTimeout(() => {
      settled = true;
      resolve();
    }, EDITOR_STARTUP_GRACE_MS);

    const rejectStartup = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(startupTimer);
      reject(new Error("The configured editor could not be started."));
    };

    try {
      launchEditor(target, editorCommand(editor), rejectStartup);
    } catch {
      rejectStartup();
    }
  });

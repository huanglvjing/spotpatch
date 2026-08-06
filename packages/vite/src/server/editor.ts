import launchEditor from "launch-editor";

export type EditorErrorCallback = (
  fileName: string,
  errorMessage: string | null,
) => void;

export type EditorLauncher = (target: string, onError: EditorErrorCallback) => void;

export const launchVSCode: EditorLauncher = (target, onError) => {
  launchEditor(target, "code", onError);
};

import { spawn, type SpawnOptions } from "node:child_process";

import type { SpotPatchEditorPreference } from "@spotpatch/shared";
import launchEditor from "launch-editor";

const EDITOR_STARTUP_GRACE_MS = 300;

interface SpawnedEditorProcess {
  once(event: "error", listener: (error: Error) => void): SpawnedEditorProcess;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedEditorProcess;
}

type EditorProcessSpawner = (
  command: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => SpawnedEditorProcess;

type FallbackEditorLauncher = (
  target: string,
  editor: string | undefined,
  onError: () => void,
) => void;

export interface EditorLaunchDependencies {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly fallbackLauncher: FallbackEditorLauncher;
  readonly processSpawner: EditorProcessSpawner;
  readonly startupGraceMs: number;
}

export type EditorLauncher = (
  target: string,
  editor: SpotPatchEditorPreference,
) => Promise<SpotPatchEditorPreference>;

function normalizedEditorEnvironment(environment: Readonly<NodeJS.ProcessEnv>): string {
  return [
    environment.TERM_PROGRAM,
    environment.VSCODE_GIT_ASKPASS_NODE,
    environment.VSCODE_GIT_ASKPASS_MAIN,
    environment.GIT_ASKPASS,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .replaceAll("\\", "/")
    .toLowerCase();
}

export function detectIntegratedEditor(
  environment: Readonly<NodeJS.ProcessEnv>,
): Exclude<SpotPatchEditorPreference, "auto"> | undefined {
  const signature = normalizedEditorEnvironment(environment);

  if (signature === "cursor" || signature.includes("/cursor")) {
    return "cursor";
  }

  if (
    signature === "vscode" ||
    signature.includes("visual studio code") ||
    /(^|\/)(code|code-insiders)(\.exe)?($|\/)/u.test(signature)
  ) {
    return "vscode";
  }

  return undefined;
}

function editorCommand(editor: Exclude<SpotPatchEditorPreference, "auto">): string {
  return editor === "cursor" ? "cursor" : "code";
}

const DEFAULT_DEPENDENCIES: EditorLaunchDependencies = Object.freeze({
  environment: process.env,
  fallbackLauncher: launchEditor,
  processSpawner: (
    command: string,
    arguments_: readonly string[],
    options: SpawnOptions,
  ) => spawn(command, [...arguments_], options),
  startupGraceMs: EDITOR_STARTUP_GRACE_MS,
});

export function createEditorLauncher(
  dependencies: EditorLaunchDependencies = DEFAULT_DEPENDENCIES,
): EditorLauncher {
  return (target, configuredEditor) => {
    const integratedEditor = detectIntegratedEditor(dependencies.environment);
    const resolvedEditor =
      configuredEditor === "auto" ? integratedEditor : configuredEditor;

    return new Promise<SpotPatchEditorPreference>((resolve, reject) => {
      let settled = false;
      const settle = (
        error?: Error,
        editor: SpotPatchEditorPreference = resolvedEditor ?? "auto",
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(startupTimer);

        if (error === undefined) {
          resolve(editor);
        } else {
          reject(error);
        }
      };
      const startupTimer = setTimeout(settle, dependencies.startupGraceMs);
      const rejectStartup = (): void => {
        settle(new Error("The configured editor could not be started."));
      };

      try {
        if (resolvedEditor === undefined) {
          dependencies.fallbackLauncher(target, undefined, rejectStartup);
          return;
        }

        const child = dependencies.processSpawner(
          editorCommand(resolvedEditor),
          ["--goto", target],
          {
            env: dependencies.environment,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        child.once("error", rejectStartup);
        child.once("exit", (code, signal) => {
          if (code === 0) {
            settle(undefined, resolvedEditor);
            return;
          }

          if (code !== null || signal !== null) {
            rejectStartup();
          }
        });
      } catch {
        rejectStartup();
      }
    });
  };
}

export const launchConfiguredEditor = createEditorLauncher();

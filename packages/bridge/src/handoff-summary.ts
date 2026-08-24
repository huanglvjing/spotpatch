import path from "node:path";

import type { externalHandoffSnapshotSchema } from "@spotpatch/shared";
import type { z } from "zod";

type ValidatedHandoffSnapshot = z.infer<typeof externalHandoffSnapshotSchema>;

const CONTROL_CHARACTERS = /\p{Cc}+/gu;
const WHITESPACE = /\s+/gu;

function oneLine(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(WHITESPACE, " ").trim();
}

function projectRelativeSourcePath(value: string): string | undefined {
  if (
    value.length === 0 ||
    oneLine(value) !== value ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return undefined;
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return undefined;
  }

  return path.posix.normalize(value) === value ? value : undefined;
}

function actionableSourceLocation(
  target: ValidatedHandoffSnapshot["annotation"]["targets"][number],
): string | undefined {
  if (target.source.relativePath !== undefined && target.source.line !== undefined) {
    const relativePath = projectRelativeSourcePath(target.source.relativePath);
    if (relativePath === undefined) return undefined;
    const column =
      target.source.column === undefined ? "" : `:${String(target.source.column)}`;
    return `${relativePath}:${String(target.source.line)}${column}`;
  }

  if (target.code !== undefined) {
    const relativePath = projectRelativeSourcePath(target.code.relativePath);
    if (relativePath === undefined) return undefined;
    return `${relativePath}:${String(target.code.startLine)}`;
  }

  return undefined;
}

function sourceLocation(
  target: ValidatedHandoffSnapshot["annotation"]["targets"][number],
): string {
  return (
    actionableSourceLocation(target) ??
    (target.source.relativePath === undefined
      ? "source location unavailable"
      : oneLine(target.source.relativePath))
  );
}

function elementIdentity(
  target: ValidatedHandoffSnapshot["annotation"]["targets"][number],
): string {
  return `<${oneLine(target.element.tagName)}>`;
}

export function hasUniqueActionableHandoffTargets(
  snapshot: ValidatedHandoffSnapshot,
): boolean {
  const keys = new Set<string>();

  for (const target of snapshot.annotation.targets) {
    const location = actionableSourceLocation(target);
    if (location === undefined) return false;
    const key = `${location}\0${elementIdentity(target)}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }

  return true;
}

/**
 * A bounded, task-oriented projection of a validated handoff. It deliberately
 * excludes DOM selectors/attributes, styles, source excerpts, page URLs,
 * tokens, and opaque IDs.
 */
export function formatHandoffTaskSummary(snapshot: ValidatedHandoffSnapshot): string {
  const targets = snapshot.annotation.targets.flatMap((target, index) => {
    const instruction = oneLine(target.instruction);
    if (instruction.length === 0) return [];
    return [
      `${String(index + 1)}. Source: ${sourceLocation(target)}`,
      `   Element: ${elementIdentity(target)}`,
      `   Request: ${instruction}`,
    ];
  });

  return [
    `User-approved target summary (${String(snapshot.annotation.targets.length)}):`,
    ...targets,
  ].join("\n");
}

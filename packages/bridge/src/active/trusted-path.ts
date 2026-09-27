import path from "node:path";

interface PathSemantics {
  readonly isAbsolute: (value: string) => boolean;
  readonly relative: (from: string, to: string) => string;
  readonly sep: string;
}

/** True when `candidate` is `root` itself or lies inside it. */
export function isPathWithin(
  root: string,
  candidate: string,
  semantics: PathSemantics = path,
): boolean {
  const relative = semantics.relative(root, candidate);
  return (
    relative === "" ||
    (!semantics.isAbsolute(relative) &&
      !relative.startsWith(`..${semantics.sep}`) &&
      relative !== "..")
  );
}

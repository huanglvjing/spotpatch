// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BRAND_MARK_CONTENT } from "./brand-mark-content.js";
import { createBrandMark } from "./brand-mark.js";

interface SvgSnapshot {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly SvgSnapshot[];
}

const NON_VISUAL_ELEMENTS = new Set(["title", "desc"]);
const ROOT_PRESENTATION_ATTRIBUTES = new Set([
  "aria-hidden",
  "aria-labelledby",
  "class",
  "fill",
  "focusable",
  "height",
  "role",
  "width",
]);
const ASSET_RELATIVE_PATH = "docs/assets/spotpatch-logo-mark.svg";

function repositoryRoot(): string {
  const currentDirectory = process.cwd();
  return existsSync(resolve(currentDirectory, ASSET_RELATIVE_PATH))
    ? currentDirectory
    : resolve(currentDirectory, "../..");
}

function snapshot(element: Element, root = false): SvgSnapshot {
  const attributes = Object.fromEntries(
    [...element.attributes]
      .filter(({ name }) => !(root && ROOT_PRESENTATION_ATTRIBUTES.has(name)))
      .map(({ name, value }) => ({ name, value }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, value }) => [name, value]),
  );

  return {
    tag: element.localName,
    attributes,
    children: [...element.children]
      .filter(({ localName }) => !NON_VISUAL_ELEMENTS.has(localName))
      .map((child) => snapshot(child)),
  };
}

describe("SpotPatch brand mark", () => {
  it("keeps the Shadow DOM vector in sync with the canonical SVG asset", () => {
    const root = repositoryRoot();
    const canonicalSvg = readFileSync(resolve(root, ASSET_RELATIVE_PATH), "utf8");
    for (const legacyAsset of ["spotpatch-icon.svg", "spotpatch-logo.svg"]) {
      expect(readFileSync(resolve(root, `docs/assets/${legacyAsset}`), "utf8")).toBe(
        canonicalSvg,
      );
    }
    const canonicalDocument = new DOMParser().parseFromString(
      canonicalSvg,
      "image/svg+xml",
    );
    const canonicalRoot = canonicalDocument.documentElement;
    const runtimeRoot = createBrandMark(document, BRAND_MARK_CONTENT);
    const defaultRuntimeRoot = createBrandMark(document);

    expect(snapshot(runtimeRoot, true)).toEqual(snapshot(canonicalRoot, true));
    expect(snapshot(defaultRuntimeRoot, true)).toEqual(snapshot(canonicalRoot, true));
  });
});

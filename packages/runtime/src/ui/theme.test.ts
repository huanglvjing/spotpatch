import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const UI_DIRECTORY = dirname(fileURLToPath(import.meta.url));
// The theme owns every color token; the brand mark is fixed SVG artwork.
const LITERAL_COLOR_OWNERS = new Set(["theme.ts", "brand-mark-content.ts"]);
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/giu;
const CUSTOM_PROPERTY_USE = /var\((--spotpatch-[a-z0-9-]+)/gu;
const CUSTOM_PROPERTY_DECLARATION = /(--spotpatch-[a-z0-9-]+)\s*:/gu;

const uiSources = readdirSync(UI_DIRECTORY)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) =>
    Object.freeze({ file, source: readFileSync(join(UI_DIRECTORY, file), "utf8") }),
  );

function matches(pattern: RegExp, source: string): string[] {
  return Array.from(source.matchAll(pattern), (match) => match[1] ?? match[0]);
}

describe("UI theme", () => {
  it("keeps literal colors inside the theme", () => {
    const offenders = uiSources
      .filter(({ file }) => !LITERAL_COLOR_OWNERS.has(file))
      .flatMap(({ file, source }) =>
        matches(LITERAL_COLOR, source).map((color) => `${file}: ${color}`),
      );

    expect(offenders).toEqual([]);
  });

  it("declares every custom property that a stylesheet reads", () => {
    const declared = new Set(
      uiSources.flatMap(({ source }) => matches(CUSTOM_PROPERTY_DECLARATION, source)),
    );
    const undeclared = uiSources.flatMap(({ file, source }) =>
      matches(CUSTOM_PROPERTY_USE, source)
        .filter((property) => !declared.has(property))
        .map((property) => `${file}: ${property}`),
    );

    expect(undeclared).toEqual([]);
  });

  it("uses every custom property it declares", () => {
    const used = new Set(
      uiSources.flatMap(({ source }) => matches(CUSTOM_PROPERTY_USE, source)),
    );
    const unused = uiSources.flatMap(({ file, source }) =>
      matches(CUSTOM_PROPERTY_DECLARATION, source)
        .filter((property) => !used.has(property))
        .map((property) => `${file}: ${property}`),
    );

    expect(unused).toEqual([]);
  });
});

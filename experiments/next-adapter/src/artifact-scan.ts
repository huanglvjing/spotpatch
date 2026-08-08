import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isUnknownRecord(error) && error.code === code;
}

async function readDirectoryIfPresent(directory: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function readFileIfPresent(absolutePath: string): Promise<Buffer | null> {
  try {
    return await readFile(absolutePath);
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

export async function fileTreeContains(
  directory: string,
  needle: Buffer,
): Promise<boolean> {
  const entries = await readDirectoryIfPresent(directory);

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (await fileTreeContains(absolutePath, needle)) {
        return true;
      }
    } else if (entry.isFile()) {
      const content = await readFileIfPresent(absolutePath);

      if (content?.includes(needle) === true) {
        return true;
      }
    }
  }

  return false;
}

function sourceMapMatches(
  value: unknown,
  expectedSource: string,
  expectedContent: string,
): boolean {
  if (!isUnknownRecord(value)) {
    return false;
  }

  const { sources, sourcesContent } = value;

  if (Array.isArray(sources) && Array.isArray(sourcesContent)) {
    const hasMatchingSource = sources.some(
      (source, index) =>
        typeof source === "string" &&
        source.endsWith(expectedSource) &&
        sourcesContent[index] === expectedContent,
    );

    if (hasMatchingSource) {
      return true;
    }
  }

  const { sections } = value;

  return (
    Array.isArray(sections) &&
    sections.some(
      (section) =>
        isUnknownRecord(section) &&
        sourceMapMatches(section.map, expectedSource, expectedContent),
    )
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function contentContainsSourceMap(
  content: Buffer,
  expectedSource: string,
  expectedContent: string,
): boolean {
  const text = content.toString("utf8");
  const directMap = parseJson(text);

  if (sourceMapMatches(directMap, expectedSource, expectedContent)) {
    return true;
  }

  const inlineMapPattern =
    /sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)/gu;

  for (const match of text.matchAll(inlineMapPattern)) {
    const encodedMap = match[1];

    if (encodedMap === undefined) {
      continue;
    }

    const decodedMap = Buffer.from(encodedMap, "base64").toString("utf8");

    if (sourceMapMatches(parseJson(decodedMap), expectedSource, expectedContent)) {
      return true;
    }
  }

  return false;
}

export async function fileTreeContainsSourceMap(
  directory: string,
  expectedSource: string,
  expectedContent: string,
): Promise<boolean> {
  const entries = await readDirectoryIfPresent(directory);

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        await fileTreeContainsSourceMap(absolutePath, expectedSource, expectedContent)
      ) {
        return true;
      }
    } else if (entry.isFile()) {
      const content = await readFileIfPresent(absolutePath);

      if (
        content !== null &&
        contentContainsSourceMap(content, expectedSource, expectedContent)
      ) {
        return true;
      }
    }
  }

  return false;
}

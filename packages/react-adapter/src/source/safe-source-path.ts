function stripQueryAndFragment(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? "";
}

function isSafeRelativePath(path: string): boolean {
  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function isThirdPartySource(fileName: string): boolean {
  const normalized = fileName.replaceAll("\\", "/");
  return (
    normalized.startsWith("node_modules/") || normalized.includes("/node_modules/")
  );
}

export function toSafeRelativeSourcePath(fileName: string): string | undefined {
  if (fileName.length === 0 || isThirdPartySource(fileName)) {
    return undefined;
  }

  let normalized = fileName.replaceAll("\\", "/");

  try {
    if (/^https?:\/\//i.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    return undefined;
  }

  normalized = stripQueryAndFragment(normalized);
  const sourceIndex = normalized.lastIndexOf("/src/");

  if (sourceIndex >= 0) {
    const relativePath = normalized.slice(sourceIndex + 1);
    return isSafeRelativePath(relativePath) ? relativePath : undefined;
  }

  if (normalized.startsWith("src/") && isSafeRelativePath(normalized)) {
    return normalized;
  }

  return undefined;
}

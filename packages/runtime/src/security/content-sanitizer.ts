const INLINE_DATA_PATTERN = /data:[^\s"'<>]*;base64,[a-z0-9+/_=-]+/giu;
const BLOB_URL_PATTERN = /blob:[^\s"'<>]+/giu;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/giu;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(authorization|cookie|set-cookie|api[-_]?key|(?:access[-_]?|refresh[-_]?|auth[-_]?)?token|secret)\b(\s*[:=]\s*)([^\s,;"'<>]+)/giu;
const SENSITIVE_EXACT_NAMES = new Set([
  "authorization",
  "cookie",
  "defaultvalue",
  "password",
  "setcookie",
  "value",
]);

const MAX_ATTRIBUTE_CHARACTERS = 500;
const MAX_SVG_PATH_CHARACTERS = 256;

function compactName(name: string): string {
  return name.toLowerCase().replaceAll(/[-_:]/gu, "");
}

function truncate(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters
    ? value
    : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

export function isSensitiveAttributeName(name: string): boolean {
  const compact = compactName(name);

  return (
    SENSITIVE_EXACT_NAMES.has(compact) ||
    compact.includes("apikey") ||
    compact.includes("authorization") ||
    compact.includes("secret") ||
    compact.includes("token")
  );
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(INLINE_DATA_PATTERN, "[redacted inline data]")
    .replace(BLOB_URL_PATTERN, "[redacted blob URL]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(
      SECRET_ASSIGNMENT_PATTERN,
      (_match, name: string, separator: string) => `${name}${separator}[redacted]`,
    );
}

function sanitizeParsedUrl(url: URL): string {
  url.username = "";
  url.password = "";

  for (const [name, value] of url.searchParams) {
    if (isSensitiveAttributeName(name)) {
      url.searchParams.set(name, "[redacted]");
    } else {
      url.searchParams.set(name, redactSensitiveText(value));
    }
  }

  if (/token|secret|authorization|api[-_]?key/iu.test(url.hash)) {
    url.hash = "#[redacted]";
  }

  return url.toString();
}

export function sanitizeUrl(value: string, baseUrl: string): string {
  const trimmed = value.trim();

  if (/^(?:blob|data|javascript):/iu.test(trimmed)) {
    return "[redacted URL]";
  }

  const normalized = redactSensitiveText(trimmed);

  try {
    const parsed = new URL(normalized, baseUrl);
    const sanitized = sanitizeParsedUrl(parsed);
    const base = new URL(baseUrl);

    if (!/^[a-z][a-z\d+.-]*:/iu.test(normalized) && parsed.origin === base.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return sanitized;
  } catch {
    return truncate(normalized, MAX_ATTRIBUTE_CHARACTERS);
  }
}

export function sanitizeAttributeValue(
  name: string,
  value: string,
  baseUrl: string,
): string | undefined {
  if (isSensitiveAttributeName(name)) {
    return undefined;
  }

  if (name === "href" || name === "src") {
    return sanitizeUrl(value, baseUrl);
  }

  if (name === "d" && value.length > MAX_SVG_PATH_CHARACTERS) {
    return `${value.slice(0, MAX_SVG_PATH_CHARACTERS)}…`;
  }

  return truncate(redactSensitiveText(value), MAX_ATTRIBUTE_CHARACTERS);
}

export function sanitizeCssText(value: string): string {
  return redactSensitiveText(value);
}

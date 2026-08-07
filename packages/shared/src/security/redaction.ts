const INLINE_DATA_PATTERN = /data:[^\s"'<>]*;base64,[a-z0-9+/_=-]+/giu;
const BLOB_URL_PATTERN = /blob:[^\s"'<>]+/giu;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/giu;
const URL_CREDENTIAL_PATTERN = /\b(https?:\/\/)[^/\s:@]+:[^/\s@]+@/giu;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(authorization|cookie|set-cookie|api[-_]?key|(?:access[-_]?|refresh[-_]?|auth[-_]?)?token|secret|password|default[-_]?value|value)\b(\s*[:=]\s*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\\r\n])*`|[^\s,;"'<>]+)/giu;
const SENSITIVE_EXACT_NAMES = new Set([
  "authorization",
  "cookie",
  "defaultvalue",
  "password",
  "setcookie",
  "value",
]);
const MAX_URL_CHARACTERS = 500;

function compactName(name: string): string {
  return name.toLowerCase().replaceAll(/[-_:]/gu, "");
}

function truncate(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters
    ? value
    : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

export function isSensitiveName(name: string): boolean {
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
    .replace(URL_CREDENTIAL_PATTERN, "$1[redacted]@")
    .replace(
      SECRET_ASSIGNMENT_PATTERN,
      (_match, name: string, separator: string, assignedValue: string) => {
        const quote = assignedValue.at(0);
        const quoted = quote === '"' || quote === "'" || quote === "`";
        return `${name}${separator}${quoted ? quote : ""}[redacted]${quoted ? quote : ""}`;
      },
    );
}

function sanitizeParsedUrl(url: URL): string {
  url.username = "";
  url.password = "";

  for (const [name, value] of url.searchParams) {
    if (isSensitiveName(name)) {
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
    return truncate(normalized, MAX_URL_CHARACTERS);
  }
}

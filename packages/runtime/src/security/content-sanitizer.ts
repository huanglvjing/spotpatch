import { isSensitiveName, redactSensitiveText, sanitizeUrl } from "@spotpatch/shared";

const MAX_ATTRIBUTE_CHARACTERS = 500;
const MAX_SVG_PATH_CHARACTERS = 256;

function truncate(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters
    ? value
    : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

export function isSensitiveAttributeName(name: string): boolean {
  return isSensitiveName(name);
}

export { redactSensitiveText, sanitizeUrl };

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

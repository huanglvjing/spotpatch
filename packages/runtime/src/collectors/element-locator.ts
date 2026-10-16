import { ELEMENT_INSTANCE_LIMITS, redactSensitiveText } from "@spotpatch/shared";

function escapeIdentifier(value: string): string {
  return Array.from(value)
    .map((character) =>
      /[a-z\d_-]/iu.test(character)
        ? character
        : `\\${(character.codePointAt(0) ?? 0).toString(16)} `,
    )
    .join("");
}

function uniqueMatch(element: Element, selector: string): boolean {
  if (selector.length > ELEMENT_INSTANCE_LIMITS.selectorCharacters) return false;
  try {
    const matches = element.ownerDocument.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/** Returns only a verified, unredacted locator. Empty means unavailable. */
export function createElementLocator(element: Element): string {
  if (!element.isConnected || element.getRootNode() !== element.ownerDocument)
    return "";
  const segments: string[] = [];
  let current: Element | null = element;
  while (current !== null && segments.length < ELEMENT_INSTANCE_LIMITS.locatorDepth) {
    const tag = current.localName;
    const testId = current.getAttribute("data-testid");
    const anchors = [
      ...(current.id.length > 0 && redactSensitiveText(current.id) === current.id
        ? [`${tag}#${escapeIdentifier(current.id)}`]
        : []),
      ...(testId && redactSensitiveText(testId) === testId
        ? [
            `${tag}[data-testid="${testId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`,
          ]
        : []),
    ];
    for (const anchor of anchors) {
      const candidate = [anchor, ...segments].join(" > ");
      // Redaction must not turn a locator into a different or ambiguous selector.
      if (
        redactSensitiveText(candidate) === candidate &&
        uniqueMatch(element, candidate)
      )
        return candidate;
    }
    const siblings =
      current.parentElement === null
        ? [current]
        : Array.from(current.parentElement.children).filter(
            (sibling) => sibling.localName === tag,
          );
    const segment =
      siblings.length > 1
        ? `${tag}:nth-of-type(${String(siblings.indexOf(current) + 1)})`
        : tag;
    segments.unshift(segment);
    const candidate = segments.join(" > ");
    if (uniqueMatch(element, candidate)) return candidate;
    if (candidate.length > ELEMENT_INSTANCE_LIMITS.selectorCharacters) return "";
    current = current.parentElement;
  }
  return "";
}

import { BRAND_MARK_CONTENT } from "./brand-mark-content.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
declare const __SPOTPATCH_INLINE_BRAND_MARK__: boolean;
declare const __SPOTPATCH_BRAND_MARK_CONTENT__: string | undefined;

/**
 * Deliberately empty fail-closed fallback for an invalid Vite injection.
 *
 * The browser bundle must not carry a second logo implementation: normal
 * Vite development injects BRAND_MARK_CONTENT lexically, while standalone
 * Runtime builds inline the canonical asset at compile time. Keeping this
 * branch empty preserves the bundle budget and prevents stale branding if a
 * host violates either build contract.
 */
const FALLBACK_BRAND_MARK_CONTENT = "";

function resolveBrandMarkContent(override?: string): Readonly<{
  readonly content: string;
  readonly viewBox: string;
}> {
  if (override !== undefined) {
    return { content: override, viewBox: "0 0 512 512" };
  }

  const injected =
    typeof __SPOTPATCH_BRAND_MARK_CONTENT__ === "string"
      ? __SPOTPATCH_BRAND_MARK_CONTENT__
      : undefined;
  if (typeof injected === "string") {
    return { content: injected, viewBox: "0 0 512 512" };
  }

  return __SPOTPATCH_INLINE_BRAND_MARK__
    ? { content: BRAND_MARK_CONTENT, viewBox: "0 0 512 512" }
    : { content: FALLBACK_BRAND_MARK_CONTENT, viewBox: "0 0 1 1" };
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tagName: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  return element;
}

/** Vector form of docs/assets/spotpatch-logo-mark.svg; safe to inline in Shadow DOM. */
export function createBrandMark(document: Document, content?: string): SVGSVGElement {
  const resolved = resolveBrandMarkContent(content);
  const svg = svgElement(document, "svg", {
    xmlns: SVG_NAMESPACE,
    class: "spotpatch-brand-mark",
    viewBox: resolved.viewBox,
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.innerHTML = resolved.content;
  return svg;
}

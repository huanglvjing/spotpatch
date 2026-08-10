import { BRAND_MARK_CONTENT } from "./brand-mark-content.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
declare const __SPOTPATCH_INLINE_BRAND_MARK__: boolean;
declare const __SPOTPATCH_BRAND_MARK_CONTENT__: string | undefined;

/** Compact fallback used by the Vite core bundle when the trusted dev asset is injected separately. */
const FALLBACK_BRAND_MARK_CONTENT = `
  <defs>
    <linearGradient id="spotpatch-brand-gradient" x1="35" y1="42" x2="184" y2="176" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7c22ff" />
      <stop offset="0.52" stop-color="#4a69ff" />
      <stop offset="1" stop-color="#06d9ef" />
    </linearGradient>
  </defs>
  <path d="M106 42C67 42 43 68 43 105c0 36 24 61 63 96 39-35 63-60 63-96 0-37-24-63-63-63Z" fill="none" stroke="url(#spotpatch-brand-gradient)" stroke-linecap="square" stroke-linejoin="miter" stroke-width="14" />
  <path d="M106 25v42" fill="none" stroke="url(#spotpatch-brand-gradient)" stroke-linecap="square" stroke-linejoin="miter" stroke-width="14" />
  <path d="M35 109h20m102 0h38" fill="none" stroke="url(#spotpatch-brand-gradient)" stroke-linecap="square" stroke-linejoin="miter" stroke-width="13" />
  <path d="m94 89-18 19 18 17m39-36 18 19-18 17" fill="none" stroke="url(#spotpatch-brand-gradient)" stroke-linecap="square" stroke-linejoin="miter" stroke-width="9" />
  <path d="m119 61-20 45 15 11-13 47 30-56-16-12 4-35Z" fill="url(#spotpatch-brand-gradient)" />
`;

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
    : { content: FALLBACK_BRAND_MARK_CONTENT, viewBox: "0 0 210 208" };
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

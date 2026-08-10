const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Static trusted markup from docs/assets/spotpatch-logo-mark.svg.
 * It is kept inline so the Runtime does not need a network or asset request.
 */
const BRAND_MARK_CONTENT = `
  <defs>
    <linearGradient id="locator-gradient" x1="76" y1="92" x2="436" y2="374" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#B61CFF" />
      <stop offset="0.38" stop-color="#6D35FF" />
      <stop offset="0.72" stop-color="#168EFF" />
      <stop offset="1" stop-color="#00D9E9" />
    </linearGradient>
    <linearGradient id="left-code-gradient" x1="165" y1="166" x2="236" y2="258" gradientUnits="userSpaceOnUse">
      <stop stop-color="#A51EFF" />
      <stop offset="1" stop-color="#653BFF" />
    </linearGradient>
    <linearGradient id="right-code-gradient" x1="276" y1="166" x2="347" y2="258" gradientUnits="userSpaceOnUse">
      <stop stop-color="#158DFF" />
      <stop offset="1" stop-color="#00D8E9" />
    </linearGradient>
    <linearGradient id="bolt-gradient" x1="270" y1="111" x2="252" y2="365" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6840FF" />
      <stop offset="0.48" stop-color="#257BFF" />
      <stop offset="1" stop-color="#00CBEF" />
    </linearGradient>
  </defs>
  <path
    fill="url(#locator-gradient)"
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M256 52C345.47 52 418 124.53 418 214C418 267.55 391.98 316.24 354.04 348.02L256 468L157.96 348.02C120.02 316.24 94 267.55 94 214C94 124.53 166.53 52 256 52ZM256 88C186.41 88 130 144.41 130 214C130 258.2 152.76 297.08 187.2 319.57L256 403.8L324.8 319.57C359.24 297.08 382 258.2 382 214C382 144.41 325.59 88 256 88Z"
  />
  <rect x="238" y="20" width="36" height="84" rx="4" fill="url(#locator-gradient)" />
  <rect x="62" y="196" width="84" height="36" rx="4" fill="url(#locator-gradient)" />
  <rect x="366" y="196" width="84" height="36" rx="4" fill="url(#locator-gradient)" />
  <path
    d="M213.5 160L158 211.5L213.5 263L238 236.5L211 211.5L238 186.5L213.5 160Z"
    fill="url(#left-code-gradient)"
  />
  <path
    d="M298.5 160L354 211.5L298.5 263L274 236.5L301 211.5L274 186.5L298.5 160Z"
    fill="url(#right-code-gradient)"
  />
  <path
    d="M283 108L232 212L266 253L238 369L302 237L267 198L283 108Z"
    fill="url(#bolt-gradient)"
  />
`;

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
export function createBrandMark(document: Document): SVGSVGElement {
  const svg = svgElement(document, "svg", {
    xmlns: SVG_NAMESPACE,
    class: "spotpatch-brand-mark",
    viewBox: "0 0 512 512",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.innerHTML = BRAND_MARK_CONTENT;
  return svg;
}

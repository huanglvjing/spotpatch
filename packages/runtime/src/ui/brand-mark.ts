const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

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

/** Vector form of the supplied SpotPatch brand mark; safe to inline in Shadow DOM. */
export function createBrandMark(document: Document): SVGSVGElement {
  const svg = svgElement(document, "svg", {
    class: "spotpatch-brand-mark",
    viewBox: "0 0 210 208",
    "aria-hidden": "true",
    focusable: "false",
  });
  const definitions = svgElement(document, "defs", {});
  const gradient = svgElement(document, "linearGradient", {
    id: "spotpatch-brand-gradient",
    x1: "35",
    y1: "42",
    x2: "184",
    y2: "176",
    gradientUnits: "userSpaceOnUse",
  });
  gradient.append(
    svgElement(document, "stop", { offset: "0", "stop-color": "#7c22ff" }),
    svgElement(document, "stop", { offset: ".52", "stop-color": "#4a69ff" }),
    svgElement(document, "stop", { offset: "1", "stop-color": "#06d9ef" }),
  );
  definitions.append(gradient);
  const commonStroke = {
    fill: "none",
    stroke: "url(#spotpatch-brand-gradient)",
    "stroke-linecap": "square",
    "stroke-linejoin": "miter",
  } as const;
  const outer = svgElement(document, "path", {
    d: "M106 42C67 42 43 68 43 105c0 36 24 61 63 96 39-35 63-60 63-96 0-37-24-63-63-63Z",
    ...commonStroke,
    "stroke-width": "14",
  });
  const topStem = svgElement(document, "path", {
    d: "M106 25v42",
    ...commonStroke,
    "stroke-width": "14",
  });
  const sideStems = svgElement(document, "path", {
    d: "M35 109h20m102 0h38",
    ...commonStroke,
    "stroke-width": "13",
  });
  const brackets = svgElement(document, "path", {
    d: "m94 89-18 19 18 17m39-36 18 19-18 17",
    ...commonStroke,
    "stroke-width": "9",
  });
  const bolt = svgElement(document, "path", {
    d: "m119 61-20 45 15 11-13 47 30-56-16-12 4-35Z",
    fill: "url(#spotpatch-brand-gradient)",
  });
  svg.append(definitions, outer, topStem, sideStems, brackets, bolt);
  return svg;
}

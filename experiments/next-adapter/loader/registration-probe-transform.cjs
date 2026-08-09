"use strict";

const path = require("node:path");
const MagicString = require("magic-string").default;
const probeContract = require("./probe-contract.json");

const fileIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const markerAttributePattern = /^data-[a-z0-9-]+$/u;

function getSourcePosition(source, offset) {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return Object.freeze({ line, column });
}

function getSourceName(loaderContext, sourceMapMode) {
  if (sourceMapMode === probeContract.sourceMapModes.turbopack) {
    return path.basename(loaderContext.resourcePath);
  }

  return path
    .relative(loaderContext.rootContext, loaderContext.resourcePath)
    .split(path.sep)
    .join("/");
}

function transformRegisteredProbeSource(input) {
  if (
    typeof input.source !== "string" ||
    typeof input.fileId !== "string" ||
    !fileIdPattern.test(input.fileId) ||
    typeof input.probeId !== "string" ||
    !new RegExp(probeContract.probeIdPattern, "u").test(input.probeId) ||
    typeof input.sourceMarkerAttribute !== "string" ||
    !markerAttributePattern.test(input.sourceMarkerAttribute)
  ) {
    throw new TypeError("Invalid registration probe transform input.");
  }

  const expectedAttribute = `${probeContract.attributeName}=${JSON.stringify(probeContract.inactiveValue)}`;
  const magicString = new MagicString(input.source);
  let searchOffset = 0;
  let markerCount = 0;

  while (searchOffset < input.source.length) {
    const attributeOffset = input.source.indexOf(expectedAttribute, searchOffset);

    if (attributeOffset === -1) {
      break;
    }

    const openingOffset = input.source.lastIndexOf("<", attributeOffset);
    const closingOffset = input.source.indexOf(">", attributeOffset);

    if (openingOffset === -1 || closingOffset === -1) {
      throw new SyntaxError(
        "The registration probe attribute is outside a JSX opening element.",
      );
    }

    const openingSource = input.source.slice(openingOffset, closingOffset);

    if (openingSource.includes(input.sourceMarkerAttribute)) {
      throw new SyntaxError(
        "The registration probe refuses an existing source marker.",
      );
    }

    const position = getSourcePosition(input.source, openingOffset);
    const marker = `${input.fileId}:${String(position.line)}:${String(position.column)}`;
    const valueStart = attributeOffset + probeContract.attributeName.length + 1;
    const valueEnd = valueStart + JSON.stringify(probeContract.inactiveValue).length;
    magicString.appendLeft(
      attributeOffset,
      `${input.sourceMarkerAttribute}=${JSON.stringify(marker)} `,
    );
    magicString.overwrite(
      valueStart,
      valueEnd,
      JSON.stringify(`${probeContract.activePrefix}${input.probeId}`),
    );
    markerCount += 1;
    searchOffset = valueEnd;
  }

  if (markerCount === 0) {
    return null;
  }

  return Object.freeze({
    code: magicString.toString(),
    map: JSON.parse(
      magicString
        .generateMap({
          hires: true,
          includeContent: true,
          source: getSourceName(input.loaderContext, input.sourceMapMode),
        })
        .toString(),
    ),
    markerCount,
  });
}

module.exports = Object.freeze({ transformRegisteredProbeSource });

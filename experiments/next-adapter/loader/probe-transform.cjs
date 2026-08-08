"use strict";

const MagicString = require("magic-string").default;
const probeContract = require("./probe-contract.json");

const probeIdPattern = new RegExp(probeContract.probeIdPattern, "u");

function transformProbeSource(source, probeId, sourceName) {
  if (
    typeof source !== "string" ||
    typeof probeId !== "string" ||
    !probeIdPattern.test(probeId) ||
    typeof sourceName !== "string" ||
    sourceName === ""
  ) {
    throw new TypeError("Invalid chain probe transform input.");
  }

  const expectedAttribute = `${probeContract.attributeName}=${JSON.stringify(probeContract.inactiveValue)}`;
  const magicString = new MagicString(source);
  let searchOffset = 0;
  let markerCount = 0;

  while (searchOffset < source.length) {
    const attributeOffset = source.indexOf(expectedAttribute, searchOffset);

    if (attributeOffset === -1) {
      break;
    }

    const valueStart = attributeOffset + probeContract.attributeName.length + 1;
    const valueEnd = valueStart + JSON.stringify(probeContract.inactiveValue).length;
    magicString.overwrite(
      valueStart,
      valueEnd,
      JSON.stringify(`${probeContract.activePrefix}${probeId}`),
    );
    markerCount += 1;
    searchOffset = valueEnd;
  }

  if (markerCount === 0) {
    return null;
  }

  magicString.prepend("/* spotpatch-loader-chain-probe */\n");

  return Object.freeze({
    code: magicString.toString(),
    map: JSON.parse(
      magicString
        .generateMap({
          hires: true,
          includeContent: true,
          source: sourceName,
        })
        .toString(),
    ),
    markerCount,
  });
}

module.exports = Object.freeze({ transformProbeSource });

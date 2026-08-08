"use strict";

const path = require("node:path");
const probeContract = require("./probe-contract.json");
const { transformProbeSource } = require("./probe-transform.cjs");

const probeIdPattern = new RegExp(probeContract.probeIdPattern, "u");

function getProbeOptions(loaderContext) {
  const options = loaderContext.getOptions();

  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.probeId !== "string" ||
    !probeIdPattern.test(options.probeId) ||
    !Object.values(probeContract.sourceMapModes).includes(options.sourceMapMode)
  ) {
    throw new TypeError(
      "The chain probe loader requires safe probeId and sourceMapMode options.",
    );
  }

  return options;
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

module.exports = function chainProbeLoader(source, inputMap, metadata) {
  this.cacheable(true);

  const { probeId, sourceMapMode } = getProbeOptions(this);
  const result = transformProbeSource(
    source,
    probeId,
    getSourceName(this, sourceMapMode),
  );

  if (result === null) {
    this.callback(null, source, inputMap, metadata);
    return;
  }

  this.callback(null, result.code, result.map, metadata);
};

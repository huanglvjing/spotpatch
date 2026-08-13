import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  createStaticDataFlowAnalyzer,
  type StaticDataFlowAnalyzer,
} from "@spotpatch/analyzer";
import {
  DATA_FLOW_SCHEMA_VERSION,
  ERROR_CODES,
  SpotPatchError,
  dataFlowComponentReportRequestSchema,
  dataFlowPageReportRequestSchema,
  limitDataFlowReportCollections,
  type ComponentDataFlowReport,
  type DataFlowComponentReportRequest,
  type PageDataFlowReport,
} from "@spotpatch/shared";

import type { CreateMiddlewareOptions } from "./middleware.js";
import { readJsonRequestBody } from "./request-body.js";
import { resolveSourceFile } from "./source-file.js";

type DataFlowReport = ComponentDataFlowReport | PageDataFlowReport;

function envelopeBytes(report: DataFlowReport): number {
  return Buffer.byteLength(JSON.stringify({ ok: true, data: report }), "utf8");
}

export function limitDataFlowReportToBytes(
  report: ComponentDataFlowReport,
  maximumBytes: number,
): ComponentDataFlowReport;
export function limitDataFlowReportToBytes(
  report: PageDataFlowReport,
  maximumBytes: number,
): PageDataFlowReport;
export function limitDataFlowReportToBytes(
  report: DataFlowReport,
  maximumBytes: number,
): DataFlowReport {
  const structurallyLimited = limitDataFlowReportCollections(report);
  if (envelopeBytes(structurallyLimited) <= maximumBytes) {
    return structurallyLimited;
  }

  let limited = limitDataFlowReportCollections(structurallyLimited, {
    forceTruncation: true,
    maximumDependencies: 0,
    truncatedBy: "bytes",
  });
  if (envelopeBytes(limited) > maximumBytes) {
    throw new SpotPatchError(ERROR_CODES.INTERNAL_ERROR);
  }

  for (
    let maximumDependencies = 1;
    maximumDependencies <= structurallyLimited.dependencies.length;
    maximumDependencies += 1
  ) {
    const candidate = limitDataFlowReportCollections(structurallyLimited, {
      forceTruncation: true,
      maximumDependencies,
      truncatedBy: "bytes",
    });
    if (envelopeBytes(candidate) > maximumBytes) break;
    limited = candidate;
  }
  return limited;
}

export function createDataFlowAnalyzer(
  options: CreateMiddlewareOptions,
): StaticDataFlowAnalyzer | undefined {
  if (!options.options.dataFlow.enabled) return undefined;

  return createStaticDataFlowAnalyzer({
    root: options.root,
    registryEpoch: options.session.id,
    registerSource: (absolutePath) => options.registry.register(absolutePath),
    limits: options.options.dataFlow.limits,
  });
}

async function analyzeTarget(
  request: DataFlowComponentReportRequest,
  analyzer: StaticDataFlowAnalyzer,
  options: CreateMiddlewareOptions,
): Promise<ComponentDataFlowReport> {
  const resolvedRequest = (() => {
    if ("componentSourceId" in request) {
      const anchor = options.registry.resolveDataFlowComponent(
        request.componentSourceId,
      );
      if (anchor?.sourceVersion !== request.sourceVersion) {
        throw new SpotPatchError(ERROR_CODES.DATA_FLOW_SOURCE_STALE);
      }
      return anchor;
    }
    return request;
  })();
  const absolutePath = await resolveSourceFile({
    fileId: resolvedRequest.fileId,
    registry: options.registry,
    root: options.root,
  });
  const report = analyzer.analyzeComponent({
    absolutePath,
    line: resolvedRequest.line,
    column: resolvedRequest.column,
  });

  if (
    resolvedRequest.sourceVersion !== undefined &&
    resolvedRequest.sourceVersion !== report.component.source.sourceVersion
  ) {
    throw new SpotPatchError(ERROR_CODES.DATA_FLOW_SOURCE_STALE);
  }

  return limitDataFlowReportToBytes(
    report,
    options.options.dataFlow.limits.reportMaxBytes,
  );
}

function requireAnalyzer(
  analyzer: StaticDataFlowAnalyzer | undefined,
): StaticDataFlowAnalyzer {
  if (analyzer === undefined) {
    throw new SpotPatchError(ERROR_CODES.DATA_FLOW_DISABLED);
  }
  return analyzer;
}

export async function handleComponentDataFlowReport(
  request: IncomingMessage,
  analyzer: StaticDataFlowAnalyzer | undefined,
  options: CreateMiddlewareOptions,
): Promise<ComponentDataFlowReport> {
  const parsed = dataFlowComponentReportRequestSchema.safeParse(
    await readJsonRequestBody(
      request,
      options.options.dataFlow.limits.protocolRequestMaxBytes,
    ),
  );
  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  return analyzeTarget(parsed.data, requireAnalyzer(analyzer), options);
}

export async function handlePageDataFlowReport(
  request: IncomingMessage,
  analyzer: StaticDataFlowAnalyzer | undefined,
  options: CreateMiddlewareOptions,
): Promise<PageDataFlowReport> {
  const parsed = dataFlowPageReportRequestSchema.safeParse(
    await readJsonRequestBody(
      request,
      options.options.dataFlow.limits.protocolRequestMaxBytes,
    ),
  );
  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }
  const activeAnalyzer = requireAnalyzer(analyzer);
  const componentReports = await Promise.all(
    parsed.data.targets.map((target) => analyzeTarget(target, activeAnalyzer, options)),
  );
  const dependencies = new Map(
    componentReports.flatMap((report) =>
      report.dependencies.map((dependency) => [dependency.id, dependency] as const),
    ),
  );
  const evidence = new Map(
    componentReports.flatMap((report) =>
      report.evidence.map((entry) => [entry.id, entry] as const),
    ),
  );
  const diagnostics = new Map(
    componentReports.flatMap((report) =>
      report.diagnostics.map((entry) => [entry.id, entry] as const),
    ),
  );
  const analyzedVersions = new Set(
    componentReports.flatMap((report) => report.baseline.analyzedSourceVersions),
  );
  const reportId = `page_${createHash("sha256")
    .update(componentReports.map((report) => report.reportId).join("\0"))
    .digest("base64url")
    .slice(0, 22)}`;
  const complete = componentReports.every((report) => report.completeness.complete);

  const report = Object.freeze({
    schemaVersion: DATA_FLOW_SCHEMA_VERSION,
    reportId,
    baseline: Object.freeze({
      registryEpoch: options.session.id,
      analyzerVersion: componentReports[0]?.baseline.analyzerVersion ?? "unavailable",
      adapterSetHash: componentReports[0]?.baseline.adapterSetHash ?? "unavailable",
      analyzedSourceVersions: Object.freeze([...analyzedVersions].sort()),
    }),
    capability: Object.freeze({
      enabled: true,
      staticAnalysis: complete ? "available" : "partial",
      runtimeObservation: "dispatch-only",
      responseShape: "consumed-fields-only",
      aiAssistance: "disabled",
      reasons: Object.freeze(
        componentReports.flatMap((report) => report.capability.reasons),
      ),
    }),
    dependencies: Object.freeze([...dependencies.values()]),
    evidence: Object.freeze([...evidence.values()]),
    diagnostics: Object.freeze([...diagnostics.values()]),
    completeness: Object.freeze({
      complete,
      visitedModules: componentReports.reduce(
        (total, report) => total + report.completeness.visitedModules,
        0,
      ),
      visitedCallsites: componentReports.reduce(
        (total, report) => total + report.completeness.visitedCallsites,
        0,
      ),
      frontierCount: componentReports.reduce(
        (total, report) => total + report.completeness.frontierCount,
        0,
      ),
    }),
  });
  return limitDataFlowReportToBytes(
    report,
    options.options.dataFlow.limits.reportMaxBytes,
  );
}

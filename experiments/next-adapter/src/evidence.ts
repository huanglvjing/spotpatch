import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import evidenceSchema from "../evidence/result.schema.json";
import type { LoaderPocEvidence, ProbeCaseResult } from "./contracts.js";
import { experimentRoot, repositoryRoot } from "./fixture-matrix.js";

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);
const MAX_LOG_LENGTH = 60_000;
const schemaValidator = new Ajv2020({ allErrors: true, strict: true });
addFormats(schemaValidator);
const validateEvidence = schemaValidator.compile<LoaderPocEvidence>(evidenceSchema);

export type EvidenceArtifactId = "loader-poc" | "real-host-poc";

function getArtifactsRoot(artifactId: EvidenceArtifactId): string {
  return path.join(experimentRoot, ".artifacts", artifactId);
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  return search === "" ? value : value.split(search).join(replacement);
}

export function sanitizeLogs(logs: string, workDirectory: string): string {
  const withoutAnsi = logs.replace(ANSI_ESCAPE_PATTERN, "");
  const redactedRepository = replaceAllLiteral(
    withoutAnsi,
    repositoryRoot,
    "<repository>",
  );
  const redactedWork = replaceAllLiteral(
    redactedRepository,
    workDirectory,
    "<fixture-worktree>",
  );
  const redactedHome = replaceAllLiteral(redactedWork, os.homedir(), "<home>");

  return redactedHome.slice(-MAX_LOG_LENGTH);
}

export async function writeCaseLog(
  caseId: string,
  logs: string,
  workDirectory: string,
  artifactId: EvidenceArtifactId = "loader-poc",
): Promise<string> {
  const artifactsRoot = getArtifactsRoot(artifactId);
  const logsDirectory = path.join(artifactsRoot, "logs");
  const filename = `${caseId}.log`;
  const absolutePath = path.join(logsDirectory, filename);
  await mkdir(logsDirectory, { recursive: true });
  await writeFile(absolutePath, sanitizeLogs(logs, workDirectory), "utf8");
  return path.posix.join(".artifacts", artifactId, "logs", filename);
}

function getCaseIdentity(result: ProbeCaseResult): string {
  return `${result.fixtureId}:${result.kind}:${result.bundler}`;
}

export async function writeEvidence(
  cases: readonly ProbeCaseResult[],
  expectedCaseCount: number,
  artifactId: EvidenceArtifactId = "loader-poc",
): Promise<void> {
  const artifactsRoot = getArtifactsRoot(artifactId);
  const uniqueCaseCount = new Set(cases.map(getCaseIdentity)).size;
  const isComplete =
    cases.length === expectedCaseCount && uniqueCaseCount === expectedCaseCount;
  const evidence: LoaderPocEvidence = Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: Object.freeze({
      platform: process.platform,
      operatingSystem: `${os.type()} ${os.release()}`,
      architecture: process.arch,
      nodeVersion: process.version,
    }),
    expectedCaseCount,
    conclusion:
      isComplete && cases.every((result) => result.status === "passed")
        ? "passed"
        : "failed",
    cases,
  });

  if (!validateEvidence(evidence)) {
    throw new Error(
      `Loader POC evidence does not match its JSON Schema: ${JSON.stringify(validateEvidence.errors)}`,
    );
  }

  await mkdir(artifactsRoot, { recursive: true });
  await writeFile(
    path.join(artifactsRoot, "result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

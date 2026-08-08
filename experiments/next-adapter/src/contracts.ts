export type Bundler = "turbopack" | "webpack";
export type ProbeCaseKind = "development" | "production";
export type ProbeStatus = "failed" | "passed";

export interface ProbeCommand {
  readonly args: readonly string[];
  readonly bundler: Bundler;
}

export interface FixtureDefinition {
  readonly directory: string;
  readonly id: string;
  readonly nextVersion: string;
  readonly production: ProbeCommand;
  readonly reactVersion: string;
  readonly development: readonly ProbeCommand[];
}

export interface ProbeAssertion {
  readonly actual: string;
  readonly expected: string;
  readonly name: string;
  readonly passed: boolean;
}

export interface ProbeCaseResult {
  readonly assertions: readonly ProbeAssertion[];
  readonly bundler: Bundler;
  readonly command: string;
  readonly durationMs: number;
  readonly error: string | null;
  readonly fixtureId: string;
  readonly kind: ProbeCaseKind;
  readonly logPath: string;
  readonly nextVersion: string;
  readonly reactVersion: string;
  readonly sourceHashes: {
    readonly inputSha256: string | null;
    readonly outputSha256: string | null;
  };
  readonly status: ProbeStatus;
  readonly transformedModuleCount: number;
}

export interface LoaderPocEvidence {
  readonly cases: readonly ProbeCaseResult[];
  readonly conclusion: ProbeStatus;
  readonly environment: {
    readonly architecture: string;
    readonly nodeVersion: string;
    readonly operatingSystem: string;
    readonly platform: NodeJS.Platform;
  };
  readonly expectedCaseCount: number;
  readonly generatedAt: string;
  readonly schemaVersion: 1;
}

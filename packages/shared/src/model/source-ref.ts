export type SourceConfidence = "exact" | "probable" | "approximate" | "unknown";

export type SourceOrigin = "jsx-host" | "react-fiber" | "dom-ancestor" | "none";

export interface SourceRef {
  readonly fileId?: string;
  readonly relativePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly origin: SourceOrigin;
  readonly confidence: SourceConfidence;
}

export interface ReactContext {
  readonly supported: boolean;
  readonly version?: string;
  readonly componentName?: string;
  readonly componentSourceId?: string;
  readonly sourceVersion?: string;
  readonly componentStack: readonly string[];
  readonly source?: SourceRef;
}

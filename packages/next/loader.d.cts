interface SpotPatchNextLoaderContext {
  readonly resourcePath: string;
  async(): SpotPatchNextLoaderCallback;
  cacheable(cacheable: boolean): void;
  emitWarning(warning: Error): void;
  getOptions(): unknown;
}

type SpotPatchNextLoaderCallback = (
  error: Error | null,
  source?: string,
  sourceMap?: unknown,
  metadata?: unknown,
) => void;

declare function spotPatchNextLoader(
  this: SpotPatchNextLoaderContext,
  source: string | Buffer,
  inputMap: unknown,
  metadata: unknown,
): void;

export = spotPatchNextLoader;

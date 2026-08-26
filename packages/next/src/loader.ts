import path from "node:path";

import {
  collectDataFlowInstrumentation,
  injectSourceMarkers,
  type CollectedDataFlowInstrumentation,
  type InjectSourceMarkersResult,
} from "@spotpatch/compiler";

import {
  NEXT_ENVIRONMENT_KEYS,
  NEXT_DATA_FLOW_MODULE_ID,
  NEXT_INTERNAL_REGISTRATION_PATH,
} from "./internal/constants.js";

const MAX_CACHE_ENTRIES = 1_024;
const MAX_RESPONSE_BYTES = 4_096;
const REGISTRATION_TIMEOUT_MS = 3_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SAFE_FAILURE_CODES = new Set([
  "environment-missing",
  "epoch-mismatch",
  "options-invalid",
  "origin-invalid",
  "request-failed",
  "response-invalid",
  "response-too-large",
  "timeout",
  "transform-failed",
  "upstream-source-map-unsupported",
]);

interface LoaderOptions {
  readonly mode: "data-flow" | "source" | "source-and-data-flow";
  readonly registryEpoch: string;
}

interface LoaderContext {
  readonly resourcePath: string;
  async(): LoaderCallback;
  cacheable(cacheable: boolean): void;
  emitWarning(warning: Error): void;
  getOptions(): unknown;
}

type LoaderCallback = (
  error: Error | null,
  source?: string,
  sourceMap?: unknown,
  metadata?: unknown,
) => void;

interface RegistrationResponse {
  readonly epoch: string;
  readonly fileId: string;
}

const registrationCache = new Map<string, Promise<string>>();
const warnedCodes = new Set<string>();

function failure(code: string): Error {
  return new Error(code);
}

function safeFailureCode(error: unknown): string {
  return error instanceof Error && SAFE_FAILURE_CODES.has(error.message)
    ? error.message
    : "registration-unavailable";
}

function warnOnce(context: LoaderContext, code: string): void {
  const key = `${context.resourcePath}\0${code}`;
  if (warnedCodes.has(key)) {
    return;
  }

  warnedCodes.add(key);
  context.emitWarning(
    new Error(`[spotpatch:next:loader] ${code}; the original module was preserved.`),
  );
}

function readRequiredEnvironment(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw failure("environment-missing");
  }

  return value;
}

function parseOptions(context: LoaderContext): LoaderOptions {
  const value = context.getOptions();

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("registryEpoch" in value) ||
    typeof value.registryEpoch !== "string" ||
    !ID_PATTERN.test(value.registryEpoch) ||
    !("mode" in value) ||
    (value.mode !== "data-flow" &&
      value.mode !== "source" &&
      value.mode !== "source-and-data-flow")
  ) {
    throw failure("options-invalid");
  }

  return Object.freeze({ mode: value.mode, registryEpoch: value.registryEpoch });
}

function pruneCache(): void {
  while (registrationCache.size > MAX_CACHE_ENTRIES) {
    const oldest = registrationCache.keys().next().value;

    if (typeof oldest !== "string") {
      return;
    }

    registrationCache.delete(oldest);
  }
}

async function parseRegistrationResponse(
  response: Response,
  expectedEpoch: string,
): Promise<RegistrationResponse> {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw failure("response-too-large");
  }

  const text = await response.text();

  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw failure("response-too-large");
  }

  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw failure("response-invalid");
  }

  if (
    !response.ok ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("epoch" in value) ||
    value.epoch !== expectedEpoch ||
    !("fileId" in value) ||
    typeof value.fileId !== "string" ||
    !FILE_ID_PATTERN.test(value.fileId)
  ) {
    throw failure("response-invalid");
  }

  return Object.freeze({ epoch: value.epoch, fileId: value.fileId });
}

async function requestRegistration(
  resourcePath: string,
  options: LoaderOptions,
  dataFlow?: CollectedDataFlowInstrumentation,
): Promise<string> {
  const internalOrigin = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.internalOrigin);
  const internalSecret = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.internalSecret);
  const environmentEpoch = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.registryEpoch);

  if (environmentEpoch !== options.registryEpoch) {
    throw failure("epoch-mismatch");
  }

  const endpoint = new URL(NEXT_INTERNAL_REGISTRATION_PATH, internalOrigin);

  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.username !== "" ||
    endpoint.password !== ""
  ) {
    throw failure("origin-invalid");
  }

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SpotPatch-Internal": internalSecret,
      },
      body: JSON.stringify({
        epoch: options.registryEpoch,
        resourcePath,
        ...(dataFlow === undefined
          ? {}
          : {
              dataFlow: {
                sourceVersion: dataFlow.sourceVersion,
                components: dataFlow.anchors.flatMap((anchor) =>
                  anchor.kind === "component"
                    ? [
                        {
                          componentSourceId: anchor.id,
                          line: anchor.line,
                          column: anchor.column,
                        },
                      ]
                    : [],
                ),
              },
            }),
      }),
      signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw failure(
      error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
        ? "timeout"
        : "request-failed",
    );
  }

  return (await parseRegistrationResponse(response, options.registryEpoch)).fileId;
}

function registerSource(resourcePath: string, options: LoaderOptions): Promise<string> {
  const key = `${options.registryEpoch}\0${resourcePath}`;
  const cached = registrationCache.get(key);

  if (cached !== undefined) {
    registrationCache.delete(key);
    registrationCache.set(key, cached);
    return cached;
  }

  const pending = requestRegistration(resourcePath, options).catch((error: unknown) => {
    registrationCache.delete(key);
    throw error;
  });
  registrationCache.set(key, pending);
  pruneCache();
  return pending;
}

function prepareDataFlow(
  sourceText: string,
  resourcePath: string,
  root: string,
): CollectedDataFlowInstrumentation {
  return collectDataFlowInstrumentation({
    absolutePath: resourcePath,
    code: sourceText,
    helperModule: NEXT_DATA_FLOW_MODULE_ID,
    root,
  });
}

function transformSource(input: {
  readonly dataFlow?: CollectedDataFlowInstrumentation;
  readonly fileId: string;
  readonly mode: LoaderOptions["mode"];
  readonly resourcePath: string;
  readonly root: string;
  readonly sourceText: string;
}): InjectSourceMarkersResult | undefined {
  return injectSourceMarkers({
    absolutePath: input.resourcePath,
    code: input.sourceText,
    fileId: input.fileId,
    markers: input.mode !== "data-flow",
    root: input.root,
    ...(input.dataFlow === undefined
      ? {}
      : {
          dataFlow: {
            helperModule: NEXT_DATA_FLOW_MODULE_ID,
            instrumentation: input.dataFlow,
          },
        }),
  });
}

function adaptSourceMap(
  sourceMap: InjectSourceMarkersResult["map"],
  resourcePath: string,
): unknown {
  const value = JSON.parse(sourceMap.toString()) as unknown;

  if (
    process.env[NEXT_ENVIRONMENT_KEYS.bundler] === "turbopack" &&
    typeof value === "object" &&
    value !== null &&
    "sources" in value &&
    Array.isArray(value.sources)
  ) {
    return { ...value, sources: [path.basename(resourcePath)] };
  }

  return value;
}

export default function spotPatchNextLoader(
  this: LoaderContext,
  source: string | Buffer,
  inputMap: unknown,
  metadata: unknown,
): void {
  this.cacheable(true);
  const callback = this.async();
  const sourceText = typeof source === "string" ? source : source.toString("utf8");

  if (inputMap !== null && inputMap !== undefined) {
    warnOnce(this, "upstream-source-map-unsupported");
    callback(null, sourceText, inputMap, metadata);
    return;
  }

  let options: LoaderOptions;

  try {
    options = parseOptions(this);
  } catch (error: unknown) {
    warnOnce(this, safeFailureCode(error));
    callback(null, sourceText, inputMap, metadata);
    return;
  }

  if (options.mode === "source" && !sourceText.includes("<")) {
    callback(null, sourceText, inputMap, metadata);
    return;
  }

  let root: string;
  let dataFlow: CollectedDataFlowInstrumentation | undefined;

  try {
    root = readRequiredEnvironment(NEXT_ENVIRONMENT_KEYS.appRoot);
    dataFlow =
      options.mode === "source"
        ? undefined
        : prepareDataFlow(sourceText, this.resourcePath, root);
  } catch {
    warnOnce(this, "transform-failed");
    callback(null, sourceText, inputMap, metadata);
    return;
  }

  const registration =
    dataFlow === undefined
      ? registerSource(this.resourcePath, options)
      : requestRegistration(this.resourcePath, options, dataFlow);

  void registration.then(
    (fileId) => {
      try {
        const result = transformSource({
          fileId,
          mode: options.mode,
          resourcePath: this.resourcePath,
          root,
          sourceText,
          ...(dataFlow === undefined ? {} : { dataFlow }),
        });

        callback(
          null,
          result?.code ?? sourceText,
          result === undefined
            ? inputMap
            : adaptSourceMap(result.map, this.resourcePath),
          metadata,
        );
      } catch {
        warnOnce(this, "transform-failed");
        callback(null, sourceText, inputMap, metadata);
      }
    },
    (error: unknown) => {
      if (options.mode !== "source-and-data-flow") {
        warnOnce(this, safeFailureCode(error));
        callback(null, sourceText, inputMap, metadata);
        return;
      }

      void registerSource(this.resourcePath, options).then(
        (fileId) => {
          try {
            const result = transformSource({
              fileId,
              mode: "source",
              resourcePath: this.resourcePath,
              root,
              sourceText,
            });
            warnOnce(this, safeFailureCode(error));
            callback(
              null,
              result?.code ?? sourceText,
              result === undefined
                ? inputMap
                : adaptSourceMap(result.map, this.resourcePath),
              metadata,
            );
          } catch {
            warnOnce(this, "transform-failed");
            callback(null, sourceText, inputMap, metadata);
          }
        },
        (fallbackError: unknown) => {
          warnOnce(this, safeFailureCode(fallbackError));
          callback(null, sourceText, inputMap, metadata);
        },
      );
    },
  );
}

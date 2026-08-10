import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  createAgentJobManager,
  createRuntimeAiConfig,
  createSession,
  createSourceRegistrationService,
  createSourceRegistry,
  createSpotPatchMiddleware,
  type AgentJobManager,
  type ResolvedSpotPatchOptions,
  type SourceRegistry,
} from "@spotpatch/dev-server";
import {
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  runtimeConfigSchema,
  type SpotPatchNextBundler,
  type SpotPatchNextRouterKind,
  type SpotPatchRuntimeConfig,
} from "@spotpatch/shared";

import packageMetadata from "../package.json" with { type: "json" };
import {
  NEXT_INTERNAL_CONFIGURATION_PATH,
  NEXT_INTERNAL_REGISTRATION_PATH,
} from "./internal/constants.js";
import {
  createConfigurationRequestHandler,
  type ConfigurationServerOptions,
} from "./internal/configuration-server.js";

const SIDECAR_SELF_CHECK_LIMIT_BYTES = 16_384;
const SIDECAR_SELF_CHECK_TIMEOUT_MS = 3_000;

interface ActivateSidecarInput {
  readonly appRoot: string;
  readonly bundler: SpotPatchNextBundler;
  readonly credentials: Readonly<Record<string, string>>;
  readonly internalSecret: string;
  readonly nextVersion: string;
  readonly options: ResolvedSpotPatchOptions;
  readonly projectRoot: string;
  readonly publicOrigin: string;
  readonly registryEpoch: string;
  readonly routerKind: SpotPatchNextRouterKind;
}

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

export interface NextSidecar {
  readonly origin: string;
  activate(input: ActivateSidecarInput): Promise<void>;
  close(): Promise<void>;
}

export interface NextSidecarOptions {
  readonly configuration: ConfigurationServerOptions;
  readonly onFatalError?: () => void;
}

function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://spotpatch.invalid").pathname;
  } catch {
    return "";
  }
}

function writeUnavailable(response: ServerResponse, statusCode: number): void {
  const body = JSON.stringify({ ok: false });
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function validateCredentialEnvironment(
  options: ResolvedSpotPatchOptions,
  credentials: Readonly<Record<string, string>>,
): void {
  const expected =
    options.ai === false
      ? []
      : [
          ...new Set(
            Object.values(options.ai.providers).map((provider) => provider.apiKeyEnv),
          ),
        ].sort();
  const actual = Object.keys(credentials).sort();

  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    throw new TypeError("The SpotPatch credential environment is inconsistent.");
  }
}

async function selfCheckSidecar(
  sidecarOrigin: string,
  publicOrigin: string,
  expectedConfig: SpotPatchRuntimeConfig,
): Promise<void> {
  const response = await fetch(new URL(SPOTPATCH_ENDPOINTS.bootstrap, sidecarOrigin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: publicOrigin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: "{}",
    signal: AbortSignal.timeout(SIDECAR_SELF_CHECK_TIMEOUT_MS),
  });
  const declaredLength = Number(response.headers.get("content-length"));

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > SIDECAR_SELF_CHECK_LIMIT_BYTES
  ) {
    await response.body?.cancel();
    throw new Error("SpotPatch Sidecar self-check failed.");
  }

  const text = await response.text();

  if (
    !response.ok ||
    !response.headers.get("cache-control")?.toLowerCase().includes("no-store") ||
    Buffer.byteLength(text, "utf8") > SIDECAR_SELF_CHECK_LIMIT_BYTES
  ) {
    throw new Error("SpotPatch Sidecar self-check failed.");
  }

  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error("SpotPatch Sidecar self-check failed.", { cause: error });
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("ok" in value) ||
    value.ok !== true ||
    !("data" in value)
  ) {
    throw new Error("SpotPatch Sidecar self-check failed.");
  }

  const parsed = runtimeConfigSchema.safeParse(value.data);
  const parsedExpected = runtimeConfigSchema.safeParse(expectedConfig);

  if (
    !parsed.success ||
    !parsedExpected.success ||
    JSON.stringify(parsed.data) !== JSON.stringify(parsedExpected.data)
  ) {
    throw new Error("SpotPatch Sidecar self-check failed.");
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (
        error === undefined ||
        ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")
      ) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

export async function createNextSidecar(
  sidecarOptions: NextSidecarOptions,
): Promise<NextSidecar> {
  let active = false;
  let closed = false;
  let registry: SourceRegistry | undefined;
  let agentManager: AgentJobManager | undefined;
  let handler: RequestHandler = (_request, response) => {
    writeUnavailable(response, 503);
  };
  const configurationHandler = createConfigurationRequestHandler(
    sidecarOptions.configuration,
  );
  const server = createServer((request, response) => {
    try {
      if (requestPath(request.url) === NEXT_INTERNAL_CONFIGURATION_PATH) {
        configurationHandler(request, response);
        return;
      }

      handler(request, response);
    } catch {
      writeUnavailable(response, 500);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  server.on("error", () => {
    if (!closed) {
      sidecarOptions.onFatalError?.();
    }
  });
  const address = server.address();

  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("SpotPatch Sidecar did not bind a loopback address.");
  }
  const sidecarOrigin = `http://127.0.0.1:${String(address.port)}`;

  return Object.freeze({
    origin: sidecarOrigin,
    async activate(input: ActivateSidecarInput): Promise<void> {
      if (closed || active) {
        throw new Error("SpotPatch Sidecar activation is not available.");
      }

      validateCredentialEnvironment(input.options, input.credentials);

      if (!input.options.enabled) {
        handler = (_request, response) => {
          writeUnavailable(response, 404);
        };
        active = true;
        return;
      }

      const sourceRegistry = createSourceRegistry();
      const session = createSession();
      const runtimeConfig = Object.freeze({
        apiBase: SPOTPATCH_API_BASE,
        ai: createRuntimeAiConfig(input.options.ai),
        budget: input.options.budget,
        bundler: input.bundler,
        debug: input.options.debug,
        editor: input.options.editor,
        framework: "next",
        frameworkVersion: input.nextVersion,
        locale: input.options.locale,
        maxTargets: input.options.maxTargets,
        redact: input.options.redact,
        sessionId: session.id,
        routerKind: input.routerKind,
        sessionToken: session.token,
        shortcut: input.options.shortcut,
        spotPatchVersion: packageMetadata.version,
      }) satisfies SpotPatchRuntimeConfig;
      const manager =
        input.options.ai === false
          ? undefined
          : createAgentJobManager({
              ai: input.options.ai,
              environment: input.credentials,
              root: input.projectRoot,
            });
      const middleware = createSpotPatchMiddleware({
        ...(manager === undefined ? {} : { agentManager: manager }),
        bootstrap: {
          expectedOrigin: input.publicOrigin,
          runtimeConfig,
        },
        logger: {
          warn(message) {
            process.stderr.write(`${message}\n`);
          },
        },
        options: input.options,
        registry: sourceRegistry,
        root: input.appRoot,
        session,
      });
      const registration = await createSourceRegistrationService({
        internalSecret: input.internalSecret,
        options: input.options,
        registry: sourceRegistry,
        registryEpoch: input.registryEpoch,
        root: input.appRoot,
      });

      registry = sourceRegistry;
      agentManager = manager;
      handler = (request, response) => {
        if (requestPath(request.url) === NEXT_INTERNAL_REGISTRATION_PATH) {
          registration.handler(request, response);
          return;
        }

        middleware(request, response, () => {
          writeUnavailable(response, 404);
        });
      };
      await selfCheckSidecar(sidecarOrigin, input.publicOrigin, runtimeConfig);
      active = true;
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      handler = (_request, response) => {
        writeUnavailable(response, 503);
      };
      registry?.clear();
      await agentManager?.close();
      server.closeIdleConnections();
      const closing = closeServer(server);
      server.closeAllConnections();
      await closing;
    },
  });
}

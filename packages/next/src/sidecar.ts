import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  composeContextualAskExecutors,
  createAgentJobManager,
  createConfiguredKeyAskExecutors,
  createContextualAskManager,
  createExternalHandoffService,
  createRuntimeAiConfig,
  createRuntimeDataFlowConfig,
  createSession,
  createSourceRegistrationService,
  createSourceRegistry,
  createWorkspaceActivityCoordinator,
  createSpotPatchMiddleware,
  resolveManagedExecutionValidation,
  type AgentJobManager,
  type ContextualAskManager,
  type ExternalHandoffService,
  type ResolvedSpotPatchOptions,
  type SourceRegistry,
  type SpotPatchMiddleware,
} from "@spotpatch/dev-server";
import {
  createManagedCodexAskExecutor,
  createExternalAgentSupervisor,
  type ExternalAgentSupervisor,
} from "@spotpatch/bridge";
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

export type NextPublicRouteCanaryResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      finalUrl: string;
      kind: "unreachable" | "http" | "response-invalid";
      ok: false;
      status?: number;
    }>;

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
  checkPublicRoute(): Promise<NextPublicRouteCanaryResult>;
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

function diagnosticUrl(value: string, fallbackOrigin: string): string {
  try {
    const url = new URL(value, fallbackOrigin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return fallbackOrigin;
  }
}

async function checkBootstrapRoute(
  routeOrigin: string,
  expectedOrigin: string,
  expectedConfig: SpotPatchRuntimeConfig,
): Promise<NextPublicRouteCanaryResult> {
  const requestUrl = new URL(SPOTPATCH_ENDPOINTS.bootstrap, routeOrigin);
  let response: Response;

  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: expectedOrigin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(SIDECAR_SELF_CHECK_TIMEOUT_MS),
    });
  } catch {
    return Object.freeze({
      finalUrl: diagnosticUrl(requestUrl.href, routeOrigin),
      kind: "unreachable",
      ok: false,
    });
  }

  const redirectLocation = response.headers.get("location");
  const finalUrl = diagnosticUrl(
    redirectLocation === null
      ? response.url || requestUrl.href
      : new URL(redirectLocation, response.url || requestUrl.href).href,
    routeOrigin,
  );
  const declaredLength = Number(response.headers.get("content-length"));

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > SIDECAR_SELF_CHECK_LIMIT_BYTES
  ) {
    await response.body?.cancel();
    return Object.freeze({
      finalUrl,
      kind: "response-invalid",
      ok: false,
      status: response.status,
    });
  }

  const text = await response.text();

  if (!response.ok) {
    return Object.freeze({
      finalUrl,
      kind: "http",
      ok: false,
      status: response.status,
    });
  }

  if (
    !response.headers.get("cache-control")?.toLowerCase().includes("no-store") ||
    Buffer.byteLength(text, "utf8") > SIDECAR_SELF_CHECK_LIMIT_BYTES
  ) {
    return Object.freeze({
      finalUrl,
      kind: "response-invalid",
      ok: false,
      status: response.status,
    });
  }

  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return Object.freeze({
      finalUrl,
      kind: "response-invalid",
      ok: false,
      status: response.status,
    });
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
    return Object.freeze({
      finalUrl,
      kind: "response-invalid",
      ok: false,
      status: response.status,
    });
  }

  const parsed = runtimeConfigSchema.safeParse(value.data);
  const parsedExpected = runtimeConfigSchema.safeParse(expectedConfig);

  if (
    !parsed.success ||
    !parsedExpected.success ||
    JSON.stringify(parsed.data) !== JSON.stringify(parsedExpected.data)
  ) {
    return Object.freeze({
      finalUrl,
      kind: "response-invalid",
      ok: false,
      status: response.status,
    });
  }

  return Object.freeze({ ok: true });
}

async function selfCheckSidecar(
  sidecarOrigin: string,
  publicOrigin: string,
  expectedConfig: SpotPatchRuntimeConfig,
): Promise<void> {
  const result = await checkBootstrapRoute(sidecarOrigin, publicOrigin, expectedConfig);

  if (!result.ok) {
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
  let contextualAskManager: ContextualAskManager | undefined;
  let externalHandoffService: ExternalHandoffService | undefined;
  let externalAgentSupervisor: ExternalAgentSupervisor | undefined;
  let spotPatchMiddleware: SpotPatchMiddleware | undefined;
  let publicRouteCheck:
    | Readonly<{
        expectedConfig: SpotPatchRuntimeConfig;
        publicOrigin: string;
      }>
    | undefined;
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
      const coordinator = createWorkspaceActivityCoordinator();
      const runtimeConfig = Object.freeze({
        apiBase: SPOTPATCH_API_BASE,
        ai: createRuntimeAiConfig(input.options.ai),
        budget: input.options.budget,
        contextualAsk: Object.freeze({
          enabled: input.options.contextualAsk.enabled,
        }),
        dataFlow: createRuntimeDataFlowConfig(input.options.dataFlow),
        bundler: input.bundler,
        debug: input.options.debug,
        editor: input.options.editor,
        externalAgent: input.options.externalAgent,
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
              coordinator,
            });
      const askManager = input.options.contextualAsk.enabled
        ? createContextualAskManager({
            coordinator,
            enabled: true,
            executors: composeContextualAskExecutors({
              configuredKey:
                input.options.ai === false
                  ? []
                  : createConfiguredKeyAskExecutors({
                      ai: input.options.ai,
                      environment: input.credentials,
                      ...(input.options.contextualAsk.defaultExecutor === undefined
                        ? {}
                        : {
                            defaultExecutor:
                              input.options.contextualAsk.defaultExecutor,
                          }),
                    }),
              managedCodex: createManagedCodexAskExecutor({
                projectRoot: input.appRoot,
              }),
              ...(input.options.contextualAsk.defaultExecutor === undefined
                ? {}
                : { defaultExecutor: input.options.contextualAsk.defaultExecutor }),
            }),
            registry: sourceRegistry,
            root: input.appRoot,
          })
        : undefined;
      const handoffService = input.options.externalAgent.enabled
        ? createExternalHandoffService({
            framework: "next",
            root: input.appRoot,
            sessionId: session.id,
          })
        : undefined;
      let handoffReady = false;

      if (handoffService !== undefined) {
        try {
          await handoffService.start();
          handoffReady = true;
        } catch {
          process.stderr.write(
            "[spotpatch:next] External Agent handoff is unavailable; core tools remain active.\n",
          );
        }
      }
      externalHandoffService = handoffService;
      let supervisor: ExternalAgentSupervisor | undefined;
      if (handoffReady) {
        try {
          const validation = await resolveManagedExecutionValidation({
            ai: input.options.ai,
            appRoot: input.appRoot,
          });
          supervisor = await createExternalAgentSupervisor({
            bridgeAdapter: "next",
            checks: validation.checks,
            limits: validation.limits,
            root: input.appRoot,
            sessionId: session.id,
            projectLabel: input.appRoot.split(/[\\/]/u).at(-1) ?? "project",
          });
        } catch {
          process.stderr.write(
            "[spotpatch:next] Managed Agent control is unavailable; Inbox remains active.\n",
          );
        }
      }
      externalAgentSupervisor = supervisor;
      const middleware = createSpotPatchMiddleware({
        ...(manager === undefined ? {} : { agentManager: manager }),
        ...(askManager === undefined ? {} : { contextualAskManager: askManager }),
        ...(handoffService === undefined
          ? {}
          : { externalHandoffService: handoffService }),
        ...(supervisor === undefined ? {} : { externalAgentControl: supervisor }),
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
      contextualAskManager = askManager;
      spotPatchMiddleware = middleware;
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
      publicRouteCheck = Object.freeze({
        expectedConfig: runtimeConfig,
        publicOrigin: input.publicOrigin,
      });
      active = true;
    },
    async checkPublicRoute(): Promise<NextPublicRouteCanaryResult> {
      if (closed || !active || publicRouteCheck === undefined) {
        return Object.freeze({
          finalUrl: sidecarOrigin,
          kind: "unreachable",
          ok: false,
        });
      }

      return await checkBootstrapRoute(
        publicRouteCheck.publicOrigin,
        publicRouteCheck.publicOrigin,
        publicRouteCheck.expectedConfig,
      );
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      handler = (_request, response) => {
        writeUnavailable(response, 503);
      };
      spotPatchMiddleware?.dispose();
      spotPatchMiddleware = undefined;
      await externalAgentSupervisor?.dispose();
      externalAgentSupervisor = undefined;
      await externalHandoffService?.close();
      externalHandoffService = undefined;
      await agentManager?.close();
      agentManager = undefined;
      await contextualAskManager?.close();
      contextualAskManager = undefined;
      registry?.clear();
      server.closeIdleConnections();
      const closing = closeServer(server);
      server.closeAllConnections();
      await closing;
    },
  });
}

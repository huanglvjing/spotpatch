import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ERROR_CODES,
  SPOTPATCH_ENDPOINTS,
  SpotPatchError,
  agentCapabilityRequestSchema,
  agentJobActionRequestSchema,
  agentJobCreateRequestSchema,
  agentWorkspaceHealthRequestSchema,
  type AgentJobAction,
  type AgentJobEvent,
  type AgentJobStatus,
} from "@spotpatch/shared";

import type { AgentJobManager } from "../agent/job-manager.js";
import type { ResolvedSpotPatchOptions } from "../options.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import { authorizeAgentJobRequest } from "./agent-request.js";
import { MAX_AGENT_REQUEST_BODY_BYTES } from "./constants.js";
import { readJsonRequestBody } from "./request-body.js";

interface AgentJobRoute {
  readonly action: AgentJobAction;
  readonly jobId: string;
  readonly kind: "job-action";
}

export type AgentRequestRoute =
  | Readonly<{ kind: "capability" }>
  | Readonly<{ kind: "workspace-health" }>
  | Readonly<{ kind: "create-job" }>
  | AgentJobRoute;

export interface AgentHttpOptions {
  readonly agentManager?: AgentJobManager;
  readonly options: ResolvedSpotPatchOptions;
  readonly registry: SourceRegistry;
  readonly root: string;
}

export type WriteAgentSuccess = (
  response: ServerResponse,
  status: number,
  data: unknown,
) => void;

const AGENT_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const AGENT_JOB_ACTIONS = new Set<AgentJobAction>([
  "events",
  "result",
  "cancel",
  "apply",
  "revert",
]);
const EVENT_STREAM_END_STATUSES = new Set<AgentJobStatus>([
  "awaiting-review",
  "applied",
  "completed",
  "cancelled",
  "reverted",
  "failed",
]);

export function matchAgentRequestPath(path: string): AgentRequestRoute | undefined {
  if (path === SPOTPATCH_ENDPOINTS.agentCapability) {
    return Object.freeze({ kind: "capability" });
  }

  if (path === SPOTPATCH_ENDPOINTS.agentWorkspaceHealth) {
    return Object.freeze({ kind: "workspace-health" });
  }

  if (path === SPOTPATCH_ENDPOINTS.agentJobs) {
    return Object.freeze({ kind: "create-job" });
  }

  const prefix = `${SPOTPATCH_ENDPOINTS.agentJobs}/`;

  if (!path.startsWith(prefix)) {
    return undefined;
  }

  const segments = path.slice(prefix.length).split("/");
  const jobId = segments[0];
  const action = segments[1];

  if (
    segments.length !== 2 ||
    jobId === undefined ||
    !AGENT_JOB_ID_PATTERN.test(jobId) ||
    action === undefined ||
    !AGENT_JOB_ACTIONS.has(action as AgentJobAction)
  ) {
    return undefined;
  }

  return Object.freeze({
    kind: "job-action",
    action: action as AgentJobAction,
    jobId,
  });
}

function requireAgentManager(options: AgentHttpOptions): AgentJobManager {
  if (options.agentManager === undefined || options.options.ai === false) {
    throw new SpotPatchError(ERROR_CODES.AI_DISABLED);
  }

  return options.agentManager;
}

function writeNdjsonEvent(response: ServerResponse, event: AgentJobEvent): void {
  response.write(`${JSON.stringify(event)}\n`);
}

function streamAgentJobEvents(
  response: ServerResponse,
  manager: AgentJobManager,
  jobId: string,
): void {
  const events = manager.events(jobId);
  const current = manager.result(jobId).snapshot;
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");

  for (const event of events) {
    writeNdjsonEvent(response, event);
  }

  if (EVENT_STREAM_END_STATUSES.has(current.status)) {
    response.end();
    return;
  }

  let settled = false;
  let unsubscribe = (): void => undefined;
  const heartbeat = setInterval(() => {
    if (!settled) {
      response.write("\n");
    }
  }, 15_000);
  heartbeat.unref();
  const cleanup = (): void => {
    if (settled) {
      return;
    }

    settled = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  unsubscribe = manager.subscribe(jobId, (event) => {
    if (settled) {
      return;
    }

    writeNdjsonEvent(response, event);

    if (
      event.type === "snapshot" &&
      EVENT_STREAM_END_STATUSES.has(event.data.snapshot.status)
    ) {
      cleanup();
      response.end();
    }
  });
  response.once("close", cleanup);
  response.once("error", cleanup);
}

async function handleCapability(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentHttpOptions,
  writeSuccess: WriteAgentSuccess,
): Promise<void> {
  if (request.method !== "POST") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const parsed = agentCapabilityRequestSchema.safeParse(
    await readJsonRequestBody(request),
  );

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const controller = new AbortController();
  const abort = (): void => {
    controller.abort("agent-capability-client-disconnected");
  };
  response.once("close", abort);

  try {
    const data = await requireAgentManager(options).probe(
      parsed.data,
      controller.signal,
    );
    writeSuccess(response, 200, data);
  } finally {
    response.removeListener("close", abort);
  }
}

async function handleCreateJob(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentHttpOptions,
  writeSuccess: WriteAgentSuccess,
): Promise<void> {
  if (request.method !== "POST") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const parsed = agentJobCreateRequestSchema.safeParse(
    await readJsonRequestBody(request, MAX_AGENT_REQUEST_BODY_BYTES),
  );

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const authorizedRequest = await authorizeAgentJobRequest({
    request: parsed.data,
    options: options.options,
    registry: options.registry,
    root: options.root,
  });
  const data = requireAgentManager(options).create(authorizedRequest);
  writeSuccess(response, 202, data);
}

async function handleWorkspaceHealth(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentHttpOptions,
  writeSuccess: WriteAgentSuccess,
): Promise<void> {
  if (request.method !== "POST") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const parsed = agentWorkspaceHealthRequestSchema.safeParse(
    await readJsonRequestBody(request),
  );

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const controller = new AbortController();
  const abort = (): void => {
    controller.abort("agent-workspace-health-client-disconnected");
  };
  response.once("close", abort);

  try {
    const data = await requireAgentManager(options).workspaceHealth(controller.signal);
    writeSuccess(response, 200, data);
  } finally {
    response.removeListener("close", abort);
  }
}

async function handleJobAction(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentHttpOptions,
  route: AgentJobRoute,
  writeSuccess: WriteAgentSuccess,
): Promise<void> {
  const manager = requireAgentManager(options);

  if (request.method !== "POST") {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  const parsed = agentJobActionRequestSchema.safeParse(
    await readJsonRequestBody(request),
  );

  if (!parsed.success) {
    throw new SpotPatchError(ERROR_CODES.INVALID_REQUEST);
  }

  if (route.action === "events") {
    streamAgentJobEvents(response, manager, route.jobId);
    return;
  }

  if (route.action === "result") {
    writeSuccess(response, 200, manager.result(route.jobId));
    return;
  }

  const data =
    route.action === "cancel"
      ? manager.cancel(route.jobId)
      : route.action === "apply"
        ? await manager.apply(route.jobId)
        : await manager.revert(route.jobId);
  writeSuccess(response, 200, data);
}

export async function handleAgentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentHttpOptions,
  route: AgentRequestRoute,
  writeSuccess: WriteAgentSuccess,
): Promise<void> {
  if (route.kind === "capability") {
    await handleCapability(request, response, options, writeSuccess);
    return;
  }

  if (route.kind === "create-job") {
    await handleCreateJob(request, response, options, writeSuccess);
    return;
  }

  if (route.kind === "workspace-health") {
    await handleWorkspaceHealth(request, response, options, writeSuccess);
    return;
  }

  await handleJobAction(request, response, options, route, writeSuccess);
}

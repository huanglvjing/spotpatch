import type { ErrorCode } from "../errors/error-code.js";
import type {
  AgentCheckResult,
  AgentJobSnapshot,
  AgentJobStatus,
} from "../model/agent.js";

interface AgentJobEventBase {
  readonly schemaVersion: 2;
  readonly sequence: number;
  readonly jobId: string;
  readonly status: AgentJobStatus;
  readonly timestamp: string;
}

export type AgentJobEvent =
  | (AgentJobEventBase & {
      readonly type: "snapshot";
      readonly data: Readonly<{ snapshot: AgentJobSnapshot }>;
    })
  | (AgentJobEventBase & {
      readonly type: "phase";
      readonly data: Readonly<{ message: string }>;
    })
  | (AgentJobEventBase & {
      readonly type: "tool";
      readonly data: Readonly<{
        turn: number;
        toolCallId: string;
        toolName: string;
        state: "started" | "succeeded" | "failed";
        relativePath?: string;
        checkLabel?: string;
      }>;
    })
  | (AgentJobEventBase & {
      readonly type: "check";
      readonly data: Readonly<{ result: AgentCheckResult }>;
    })
  | (AgentJobEventBase & {
      readonly type: "result-ready";
      readonly data: Readonly<{ hasResult: true }>;
    })
  | (AgentJobEventBase & {
      readonly type: "error";
      readonly data: Readonly<{ code: ErrorCode; message: string }>;
    });

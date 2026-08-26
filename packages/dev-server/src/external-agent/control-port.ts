import type {
  ExternalAgentControlCancelRequest,
  ExternalAgentControlConnectRequest,
  ExternalAgentControlDisconnectRequest,
  ExternalAgentControlStatus,
  ExternalAgentManagedResult,
} from "@spotpatch/shared";

export interface ExternalAgentControlPort {
  getStatus(): ExternalAgentControlStatus;
  connect(
    request: ExternalAgentControlConnectRequest,
    signal: AbortSignal,
  ): Promise<ExternalAgentControlStatus>;
  disconnect(
    request: ExternalAgentControlDisconnectRequest,
  ): Promise<ExternalAgentControlStatus>;
  cancel(
    request: ExternalAgentControlCancelRequest,
  ): Promise<ExternalAgentControlStatus>;
  getResult(revision: number): ExternalAgentManagedResult | undefined;
  subscribe(listener: (status: ExternalAgentControlStatus) => void): () => void;
  dispose(): Promise<void>;
}

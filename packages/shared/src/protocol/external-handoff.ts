import { z } from "zod";

import type { SpotAnnotation } from "../model/annotation.js";
import { spotAnnotationRequestSchema } from "./requests.js";
import {
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS,
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_STATES,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_DISPATCH_PHASES,
  EXTERNAL_HANDOFF_FRAMEWORKS,
  EXTERNAL_HANDOFF_LIMITS,
  EXTERNAL_HANDOFF_REPORTABLE_DISPATCH_PHASES,
  EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
  EXTERNAL_HANDOFF_STATES,
  type ExternalHandoffActiveAdapterKind,
  type ExternalHandoffActiveAdapterState,
  type ExternalHandoffDispatchPhase,
  type ExternalHandoffFramework,
  type ExternalHandoffState,
} from "./external-handoff-constants.js";

export {
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS,
  EXTERNAL_HANDOFF_ACTIVE_ADAPTER_STATES,
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  EXTERNAL_HANDOFF_DISPATCH_PHASES,
  EXTERNAL_HANDOFF_FRAMEWORKS,
  EXTERNAL_HANDOFF_LIMITS,
  EXTERNAL_HANDOFF_REPORTABLE_DISPATCH_PHASES,
  EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
  EXTERNAL_HANDOFF_STATES,
  type ExternalHandoffActiveAdapterKind,
  type ExternalHandoffActiveAdapterState,
  type ExternalHandoffDispatchPhase,
  type ExternalHandoffFramework,
  type ExternalHandoffReportableDispatchPhase,
  type ExternalHandoffState,
} from "./external-handoff-constants.js";

const opaqueIdSchema = z
  .string()
  .min(22)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const isoTimestampSchema = z.iso.datetime();
export const externalHandoffReportableDispatchPhaseSchema = z.enum(
  EXTERNAL_HANDOFF_REPORTABLE_DISPATCH_PHASES,
);
const externalHandoffPageSummarySchema = z.strictObject({
  origin: z.string().min(1).max(2_048),
  pathname: z.string().min(1).max(2_048),
});

export const externalHandoffSummarySchema = z.strictObject({
  sessionId: opaqueIdSchema,
  framework: z.enum(EXTERNAL_HANDOFF_FRAMEWORKS),
  revision: z.number().int().positive(),
  cursor: opaqueIdSchema,
  targetCount: z.number().int().positive(),
  page: externalHandoffPageSummarySchema,
  publishedAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  state: z.enum(EXTERNAL_HANDOFF_STATES),
  pickupCount: z
    .number()
    .int()
    .nonnegative()
    .max(EXTERNAL_HANDOFF_LIMITS.maximumConnectorReceipts),
  pickedUpAt: isoTimestampSchema.optional(),
});

export const externalHandoffSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION),
  cursor: opaqueIdSchema,
  session: z.strictObject({
    id: opaqueIdSchema,
    framework: z.enum(EXTERNAL_HANDOFF_FRAMEWORKS),
  }),
  revision: z.number().int().positive(),
  publishedAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  annotation: spotAnnotationRequestSchema,
});

export const activeAdapterSummarySchema = z
  .strictObject({
    kind: z.enum(EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS),
    state: z.enum(EXTERNAL_HANDOFF_ACTIVE_ADAPTER_STATES),
    canDispatch: z.boolean(),
    connectedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .superRefine((value, context) => {
    if (value.canDispatch !== (value.state === "ready")) {
      context.addIssue({
        code: "custom",
        message: "canDispatch must match the ready state.",
        path: ["canDispatch"],
      });
    }
  });

export const dispatchSummarySchema = z.strictObject({
  adapterKind: z.enum(EXTERNAL_HANDOFF_ACTIVE_ADAPTER_KINDS),
  revision: z.number().int().positive(),
  phase: z.enum(EXTERNAL_HANDOFF_DISPATCH_PHASES),
  updatedAt: isoTimestampSchema,
});

export const externalHandoffCapabilityRequestSchema = z.strictObject({});
export const externalHandoffPublishRequestSchema = z.strictObject({
  requestId: opaqueIdSchema,
  annotation: spotAnnotationRequestSchema,
});
export const externalHandoffStatusRequestSchema = z.strictObject({
  cursor: opaqueIdSchema.optional(),
});
export const externalHandoffResolveDeliveryRequestSchema = z.strictObject({
  cursor: opaqueIdSchema,
  confirmation: z.literal("workspace-reviewed"),
});
export const externalHandoffCapabilitySchema = z.strictObject({
  enabled: z.literal(true),
  brokerReady: z.boolean(),
  activeWaitCount: z
    .number()
    .int()
    .nonnegative()
    .max(EXTERNAL_HANDOFF_LIMITS.maximumWaiters),
  snapshotSchemaVersion: z.literal(EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION),
  brokerProtocolVersion: z.literal(EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION),
  activeAdapter: activeAdapterSummarySchema.nullable(),
  dispatch: dispatchSummarySchema.nullable(),
});
export const externalHandoffPublishDeliverySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("inbox") }),
  z.strictObject({
    mode: z.literal("active"),
    adapter: activeAdapterSummarySchema,
    dispatch: dispatchSummarySchema,
  }),
]);
export const externalHandoffPublishResultSchema = z.strictObject({
  handoff: externalHandoffSummarySchema,
  delivery: externalHandoffPublishDeliverySchema,
  replayed: z.boolean(),
});
export const externalHandoffStatusResultSchema = z.strictObject({
  handoff: externalHandoffSummarySchema,
  activeAdapter: activeAdapterSummarySchema.nullable(),
  dispatch: dispatchSummarySchema.nullable(),
});

export interface ExternalHandoffSummary {
  readonly sessionId: string;
  readonly framework: ExternalHandoffFramework;
  readonly revision: number;
  readonly cursor: string;
  readonly targetCount: number;
  readonly page: Readonly<{ origin: string; pathname: string }>;
  readonly publishedAt: string;
  readonly expiresAt: string;
  readonly state: ExternalHandoffState;
  readonly pickupCount: number;
  readonly pickedUpAt?: string | undefined;
}

export interface ExternalHandoffSnapshot {
  readonly schemaVersion: typeof EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION;
  readonly cursor: string;
  readonly session: Readonly<{
    id: string;
    framework: ExternalHandoffFramework;
  }>;
  readonly revision: number;
  readonly publishedAt: string;
  readonly expiresAt: string;
  readonly annotation: SpotAnnotation;
}

export interface ActiveAdapterSummary {
  readonly kind: ExternalHandoffActiveAdapterKind;
  readonly state: ExternalHandoffActiveAdapterState;
  readonly canDispatch: boolean;
  readonly connectedAt: string;
  readonly updatedAt: string;
}

export interface DispatchSummary {
  readonly adapterKind: ExternalHandoffActiveAdapterKind;
  readonly revision: number;
  readonly phase: ExternalHandoffDispatchPhase;
  readonly updatedAt: string;
}

export type ExternalHandoffPublishDelivery =
  | Readonly<{ mode: "inbox" }>
  | Readonly<{
      mode: "active";
      adapter: ActiveAdapterSummary;
      dispatch: DispatchSummary;
    }>;

export interface ExternalHandoffPublishResult {
  readonly handoff: ExternalHandoffSummary;
  readonly delivery: ExternalHandoffPublishDelivery;
  readonly replayed: boolean;
}

export interface ExternalHandoffStatusResult {
  readonly handoff: ExternalHandoffSummary;
  readonly activeAdapter: ActiveAdapterSummary | null;
  readonly dispatch: DispatchSummary | null;
}

export interface ExternalHandoffCapability {
  readonly enabled: true;
  readonly brokerReady: boolean;
  readonly activeWaitCount: number;
  readonly snapshotSchemaVersion: typeof EXTERNAL_HANDOFF_SNAPSHOT_SCHEMA_VERSION;
  readonly brokerProtocolVersion: typeof EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION;
  readonly activeAdapter: ActiveAdapterSummary | null;
  readonly dispatch: DispatchSummary | null;
}

export type ExternalHandoffPublishRequest = z.infer<
  typeof externalHandoffPublishRequestSchema
>;
export type ExternalHandoffStatusRequest = z.infer<
  typeof externalHandoffStatusRequestSchema
>;
export type ExternalHandoffResolveDeliveryRequest = z.infer<
  typeof externalHandoffResolveDeliveryRequestSchema
>;

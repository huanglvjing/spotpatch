/** Capture evidence is framework-neutral and never grants source access. */
export const ELEMENT_INSTANCE_LIMITS = Object.freeze({
  idCharacters: 128,
  contextCharacters: 1_200,
  labelCharacters: 160,
  selectorCharacters: 2_048,
  ancestorDepth: 8,
  locatorDepth: 32,
});

export const ELEMENT_INSTANCE_STATES = [
  "captured",
  "changed",
  "detached",
  "restored",
] as const;

export const ELEMENT_INSTANCE_HINT_ATTRIBUTE = "data-spotpatch-instance";

export interface ElementInstanceContext {
  /** Opaque capture identity, not a framework key or a business record ID. */
  readonly id: string;
  readonly state: (typeof ELEMENT_INSTANCE_STATES)[number];
  readonly selectorStatus: "unique-at-capture" | "unavailable";
  readonly label: string;
  /** Sanitized nearby DOM scope; it is not a proven component boundary. */
  readonly context: string;
}

export const INSTANCE_SELECTION_INSTRUCTIONS =
  "Selected targets can be different rendered instances of the same source. Preserve each target and its instruction even when source locations match. Instance IDs identify captures, not business records. Selectors are capture-time evidence, never stable record IDs. Nearby DOM context is not a proven component boundary. Changed, detached, or restored instances are historical snapshots; verify their identity before changing code. Follow the requested scope: a selected instance does not by itself authorize changes to every instance or imply instance-only changes. For an instance-only request, establish the corresponding record/condition and check the shared component's impact; if evidence is insufficient, explain what is missing rather than guessing.";

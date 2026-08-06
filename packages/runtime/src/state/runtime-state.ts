export type RuntimeStatus =
  "idle" | "inspecting" | "selected" | "annotating" | "previewing";

export interface RuntimeState {
  readonly status: RuntimeStatus;
}

export type RuntimeEvent =
  | Readonly<{ type: "ACTIVATE" }>
  | Readonly<{ type: "HOVER" }>
  | Readonly<{ type: "SELECT" }>
  | Readonly<{ type: "CANCEL" }>
  | Readonly<{ type: "ADD_NOTE" }>
  | Readonly<{ type: "RESELECT" }>
  | Readonly<{ type: "CLOSE" }>
  | Readonly<{ type: "PREVIEW" }>
  | Readonly<{ type: "OPEN_EDITOR" }>
  | Readonly<{ type: "SAVE" }>
  | Readonly<{ type: "CANCEL_NOTE" }>
  | Readonly<{ type: "COPY_SUCCESS" }>
  | Readonly<{ type: "COPY_FAILURE" }>
  | Readonly<{ type: "BACK" }>;

const STATES = Object.freeze({
  idle: Object.freeze({ status: "idle" }),
  inspecting: Object.freeze({ status: "inspecting" }),
  selected: Object.freeze({ status: "selected" }),
  annotating: Object.freeze({ status: "annotating" }),
  previewing: Object.freeze({ status: "previewing" }),
} satisfies Record<RuntimeStatus, RuntimeState>);

export const INITIAL_RUNTIME_STATE: RuntimeState = STATES.idle;

function reduceIdle(event: RuntimeEvent): RuntimeState {
  return event.type === "ACTIVATE" ? STATES.inspecting : STATES.idle;
}

function reduceInspecting(event: RuntimeEvent): RuntimeState {
  switch (event.type) {
    case "HOVER":
      return STATES.inspecting;
    case "SELECT":
      return STATES.selected;
    case "CANCEL":
      return STATES.idle;
    default:
      return STATES.inspecting;
  }
}

function reduceSelected(event: RuntimeEvent): RuntimeState {
  switch (event.type) {
    case "ADD_NOTE":
      return STATES.annotating;
    case "RESELECT":
      return STATES.inspecting;
    case "CLOSE":
      return STATES.idle;
    case "PREVIEW":
      return STATES.previewing;
    case "OPEN_EDITOR":
      return STATES.selected;
    default:
      return STATES.selected;
  }
}

function reduceAnnotating(event: RuntimeEvent): RuntimeState {
  return event.type === "SAVE" || event.type === "CANCEL_NOTE"
    ? STATES.selected
    : STATES.annotating;
}

function reducePreviewing(event: RuntimeEvent): RuntimeState {
  switch (event.type) {
    case "COPY_SUCCESS":
    case "BACK":
      return STATES.selected;
    case "COPY_FAILURE":
      return STATES.previewing;
    default:
      return STATES.previewing;
  }
}

export function reduceRuntimeState(
  state: RuntimeState,
  event: RuntimeEvent,
): RuntimeState {
  switch (state.status) {
    case "idle":
      return reduceIdle(event);
    case "inspecting":
      return reduceInspecting(event);
    case "selected":
      return reduceSelected(event);
    case "annotating":
      return reduceAnnotating(event);
    case "previewing":
      return reducePreviewing(event);
  }
}

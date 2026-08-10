export type RuntimeStatus = "idle" | "inspecting" | "selected" | "previewing";

export interface RuntimeState {
  readonly status: RuntimeStatus;
}

export type RuntimeEvent =
  | Readonly<{ type: "ACTIVATE" }>
  | Readonly<{ type: "RESTORE" }>
  | Readonly<{ type: "HOVER" }>
  | Readonly<{ type: "SELECT" }>
  | Readonly<{ type: "CANCEL" }>
  | Readonly<{ type: "RESELECT" }>
  | Readonly<{ type: "CLOSE" }>
  | Readonly<{ type: "PREVIEW" }>
  | Readonly<{ type: "OPEN_EDITOR" }>
  | Readonly<{ type: "COPY_SUCCESS" }>
  | Readonly<{ type: "COPY_FAILURE" }>
  | Readonly<{ type: "BACK" }>;

const STATES = Object.freeze({
  idle: Object.freeze({ status: "idle" }),
  inspecting: Object.freeze({ status: "inspecting" }),
  selected: Object.freeze({ status: "selected" }),
  previewing: Object.freeze({ status: "previewing" }),
} satisfies Record<RuntimeStatus, RuntimeState>);

export const INITIAL_RUNTIME_STATE: RuntimeState = STATES.idle;

function reduceIdle(event: RuntimeEvent): RuntimeState {
  if (event.type === "ACTIVATE") {
    return STATES.inspecting;
  }

  return event.type === "RESTORE" ? STATES.selected : STATES.idle;
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
    case "previewing":
      return reducePreviewing(event);
  }
}

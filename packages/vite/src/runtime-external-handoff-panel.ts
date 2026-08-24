import {
  createExternalHandoffPanel,
  createExternalHandoffWorkflow,
  registerExternalHandoffExtension,
} from "@spotpatch/runtime/external-handoff-panel";

registerExternalHandoffExtension(
  Object.freeze({
    createPanel: createExternalHandoffPanel,
    createWorkflow: createExternalHandoffWorkflow,
  }),
);

export { createExternalHandoffWorkflow } from "./controller/external-handoff-workflow.js";
export { createExternalHandoffPanel } from "./ui/external-handoff-panel.js";
export {
  getExternalHandoffExtension,
  registerExternalHandoffExtension,
  type ExternalHandoffExtension,
  type ExternalHandoffPanel,
  type ExternalHandoffWorkflow,
} from "./ui/external-handoff-contract.js";
import { createExternalHandoffWorkflow } from "./controller/external-handoff-workflow.js";
import { createExternalHandoffPanel } from "./ui/external-handoff-panel.js";
import { registerExternalHandoffExtension } from "./ui/external-handoff-contract.js";

export function installExternalHandoffExtension(): void {
  registerExternalHandoffExtension(
    Object.freeze({
      createPanel: createExternalHandoffPanel,
      createWorkflow: createExternalHandoffWorkflow,
    }),
  );
}

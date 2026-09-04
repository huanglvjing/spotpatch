import { createContextualAskWorkflow } from "./controller/contextual-ask-workflow.js";
import {
  registerContextualAskExtension,
  type ContextualAskExtension,
} from "./ui/contextual-ask-contract.js";
import { createContextualAskPanel } from "./ui/contextual-ask-panel.js";

const EXTENSION = Object.freeze({
  createPanel: createContextualAskPanel,
  createWorkflow: createContextualAskWorkflow,
}) satisfies ContextualAskExtension;

export function installContextualAskExtension(): void {
  registerContextualAskExtension(EXTENSION);
}

export { createContextualAskPanel } from "./ui/contextual-ask-panel.js";
export { createContextualAskWorkflow } from "./controller/contextual-ask-workflow.js";
export {
  getContextualAskExtension,
  registerContextualAskExtension,
  type ContextualAskExtension,
  type ContextualAskPanel,
  type ContextualAskWorkflow,
} from "./ui/contextual-ask-contract.js";

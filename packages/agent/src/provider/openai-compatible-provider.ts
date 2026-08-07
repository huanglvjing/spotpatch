import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

import { createChatCompletionsSession } from "./chat-completions-session.js";
import { createResponsesSession } from "./responses-session.js";
import type { ProviderSession, ProviderSessionOptions } from "./provider-types.js";

export function createOpenAICompatibleProviderSession(
  options: ProviderSessionOptions,
): ProviderSession {
  switch (options.provider.protocol) {
    case "responses":
      return createResponsesSession(options);
    case "chat-completions":
      return createChatCompletionsSession(options);
    default:
      throw new SpotPatchError(ERROR_CODES.PROVIDER_PROTOCOL_UNSUPPORTED);
  }
}

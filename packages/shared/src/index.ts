export { SpotPatchError } from "./errors/spotpatch-error.js";
export { ERROR_CODES, type ErrorCode } from "./errors/error-code.js";
export type {
  ElementContext,
  PageContext,
  SpotAnnotation,
} from "./model/annotation.js";
export type { CodeContext, ContextBudget } from "./model/code-context.js";
export type {
  ReactContext,
  SourceConfidence,
  SourceOrigin,
  SourceRef,
} from "./model/source-ref.js";
export type { MatchedStyleRule, StyleContext } from "./model/style-context.js";
export {
  formatSourceMarker,
  parseSourceMarker,
  SOURCE_MARKER_ATTRIBUTE,
  type SourceMarker,
} from "./model/source-marker.js";
export {
  SPOTPATCH_API_BASE,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
} from "./protocol/endpoints.js";
export {
  openEditorRequestSchema,
  sourceContextRequestSchema,
  type OpenEditorRequest,
  type SourceContextRequest,
} from "./protocol/requests.js";
export type { ApiFailure, ApiResponse, ApiSuccess } from "./protocol/responses.js";

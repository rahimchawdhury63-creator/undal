/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

export { failure, statusFor, success, type FailureInput } from "./envelope/build.ts";
export type {
  Envelope,
  ErrorBody,
  ErrorEnvelope,
  ResponseMeta,
  SuccessEnvelope,
} from "./envelope/types.ts";
export {
  ERROR_COUNT,
  ERRORS,
  errorDefinition,
  isErrorCode,
  type ErrorCode,
} from "./errors/registry.ts";
export type { ErrorDefinition, ErrorRow, ErrorStatus } from "./errors/types.ts";
export { DEFAULT_LOCALE, parseAcceptLanguage, pickLocalized, type Locale } from "./common/locale.ts";
export {
  PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  nextCursor,
  normalizeLimit,
  type Cursor,
  type CursorPage,
} from "./common/pagination.ts";

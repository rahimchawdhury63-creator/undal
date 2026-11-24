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

export {
  ALL_COORDINATION_STATEMENTS,
  COORDINATION_STATEMENTS,
  MAX_STATEMENT_PARAMS,
  MAX_STATEMENT_ROWS,
  statementByName,
  statementFor,
  type CoordinationStatement,
  type CoordinationStatementName,
} from "./coordination/statements.ts";
export { LAT_CELL_DIVISOR, LON_CELL_DIVISOR, cellFor, cellLatIndex, cellLonIndex, cellsWithin } from "./db/cell.ts";
export {
  bboxOf,
  haversineMeters,
  inBbox,
  isOnSegment,
  pointInRing,
  type BboxE7,
  type PointE7,
} from "./db/geo.ts";
export {
  UUID_BYTES,
  binToUuid,
  isUuid,
  uuidToBin,
  uuidv7,
  uuidv7Timestamp,
  type UuidBytes,
} from "./db/uuid.ts";

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { PermissionKey } from "../rbac/keys.ts";

/**
 * What an audit row says, in the shape the writer and the verifier both use.
 *
 * The fields match `audit_log` one for one. There is no `payload` column: the digest is
 * computed from these fields at write time and stored as `hash`, which is what makes
 * the row tamper-evident — a column holding its own hash would only prove the column
 * was written twice.
 */

/** Who acted. `SYSTEM` covers workflows and alarms, which have no user. */
export type ActorType = "CUSTOMER" | "VENDOR" | "RIDER" | "ADMIN" | "SYSTEM";

/** How loud the row is when read in the admin audit list. */
export type AuditSeverity = "INFO" | "NOTICE" | "WARNING" | "CRITICAL";

/** One entry, before it has a sequence number. */
export interface AuditEntryInput {
  readonly actorId: string | null;
  readonly actorType: ActorType;
  readonly actorRole: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
  /** The permission key that authorised the action, which is what makes coverage checkable. */
  readonly action: PermissionKey | string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly subjectId: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason: string | null;
  readonly severity: AuditSeverity;
}

/** An entry that has a position in the chain. */
export interface AuditEntry extends Omit<AuditEntryInput, "userAgent"> {
  readonly seq: number;
  readonly occurredAt: string;
  readonly prevHash: Uint8Array | null;
  readonly userAgent?: string | null;
}

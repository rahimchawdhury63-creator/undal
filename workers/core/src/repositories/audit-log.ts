/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The audit register, for reading.
 *
 * `audit/write.ts` appends, `audit/export.ts` produces a CSV for an auditor, and neither answers
 * the question an operator actually has at 21:05 — "what happened to this order, and who did it".
 * This is the reader for that question: newest first, filtered, paged by sequence, with the
 * before/after the chain already records so a screen can show what changed rather than a verb.
 *
 * The rows are read, never updated: an audit log that a reader can edit is not an audit log.
 */

import type { Db } from "../db/client.ts";

/** The columns the register shows. The hashes travel with every row so a screen can show the chain. */
export const AUDIT_COLUMNS =
  "`seq`, `occurred_at`, `actor_id`, `actor_type`, `actor_role`, `action`, `resource_type`, `resource_id`, " +
  "`subject_id`, `before`, `after`, `reason`, `severity`, `request_id`, `prev_hash`, `hash`";

/** One row of the register. JSON columns arrive as text from TiDB and as objects from a stub. */
export interface AuditRow {
  readonly seq: number | string;
  readonly occurred_at: string;
  readonly actor_id: Uint8Array | null;
  readonly actor_type: string;
  readonly actor_role: string | null;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly subject_id: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly severity: string;
  readonly request_id: Uint8Array | null;
  readonly prev_hash: Uint8Array | null;
  readonly hash: Uint8Array | null;
}

/** The actor classes the register records. */
export const AUDIT_ACTOR_TYPES = ["CUSTOMER", "VENDOR", "RIDER", "ADMIN", "SYSTEM"] as const;

/** Whether a string is one of the five. */
export function isAuditActorType(value: unknown): boolean {
  return typeof value === "string" && (AUDIT_ACTOR_TYPES as readonly string[]).includes(value);
}

/** How loud a row is. */
export const AUDIT_SEVERITIES = ["INFO", "NOTICE", "WARNING", "CRITICAL"] as const;

/** Whether a string is one of the four. */
export function isAuditSeverity(value: unknown): boolean {
  return typeof value === "string" && (AUDIT_SEVERITIES as readonly string[]).includes(value);
}

/** What an operator may narrow the register by. */
export interface AuditFilter {
  readonly action: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly actorType: string | null;
  readonly severity: string | null;
  /** Return rows with a sequence strictly below this one. */
  readonly beforeSeq: number | null;
  readonly limit: number;
}

/**
 * One page of the register, newest first.
 *
 * Paged by `seq` rather than by time: sequence numbers are the chain's own ordering, they are
 * unique, and they cannot tie — which is exactly what a keyset needs and what `occurred_at` (a
 * `DATETIME(6)` two rows can share) is not.
 */
export async function listAuditRows(db: Db, filter: AuditFilter): Promise<AuditRow[]> {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];

  if (filter.action !== null) {
    where.push("`action` = ?");
    params.push(filter.action);
  }
  if (filter.resourceType !== null) {
    where.push("`resource_type` = ?");
    params.push(filter.resourceType);
  }
  if (filter.resourceId !== null) {
    where.push("`resource_id` = ?");
    params.push(filter.resourceId);
  }
  if (filter.actorType !== null) {
    where.push("`actor_type` = ?");
    params.push(filter.actorType);
  }
  if (filter.severity !== null) {
    where.push("`severity` = ?");
    params.push(filter.severity);
  }
  if (filter.beforeSeq !== null) {
    where.push("`seq` < ?");
    params.push(filter.beforeSeq);
  }

  params.push(filter.limit);
  return db.query<AuditRow>(`SELECT ${AUDIT_COLUMNS} FROM \`audit_log\` WHERE ${where.join(" AND ")} ORDER BY \`seq\` DESC LIMIT ?`, params);
}

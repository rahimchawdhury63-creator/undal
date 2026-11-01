/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId } from "../lib/ids.ts";

/**
 * The security event log: the record that outlives a suspicious session.
 *
 * Separate from `audit_log` because these are not actions taken *on* data — they are
 * evidence about the actor, they are read by a different audience (security, not
 * finance), and they must survive a session being deleted, which is exactly what
 * happens when a token is stolen.
 */

/** The kinds of event the platform raises, matching the column's CHECK. */
export type SecurityEventKind =
  | "TOKEN_REUSE"
  | "STEP_UP_FAILED"
  | "LOCKOUT"
  | "DEVICE_MISMATCH"
  | "IMPERSONATION"
  | "PASSWORD_CHANGED"
  | "RBAC_CHANGED"
  | "RECOVERY_CODE_USED"
  | "SECRET_ROTATED"
  | "BREAK_GLASS";

/** How loudly it should be read. */
export type SecuritySeverity = "INFO" | "NOTICE" | "WARNING" | "CRITICAL";

/** One event to record. */
export interface SecurityEventInput {
  readonly kind: SecurityEventKind;
  readonly severity: SecuritySeverity;
  readonly actorId: Uint8Array | null;
  readonly subjectId: Uint8Array | null;
  readonly requestId: Uint8Array;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly ip?: string | null;
  readonly nowMs?: number;
}

/**
 * Write one event.
 *
 * Failures here are swallowed deliberately: a security log that can turn a successful
 * login into a 500 is a denial of service against the product, and this row is
 * forensics, not enforcement. The failure still reaches the Worker log, which is where
 * an operator looks when the table has gaps.
 */
export async function recordSecurityEvent(db: Db, input: SecurityEventInput): Promise<void> {
  try {
    await db.execute(
      "INSERT INTO `security_events` (`id`, `kind`, `severity`, `actor_id`, `subject_id`, `request_id`, `ip`, `detail`, `created_at`) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        newId(input.nowMs ?? Date.now()),
        input.kind,
        input.severity,
        input.actorId,
        input.subjectId,
        input.requestId,
        input.ip ?? null,
        input.detail === undefined ? null : JSON.stringify(input.detail),
        sqlDatetime(new Date(input.nowMs ?? Date.now())),
      ],
    );
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "security event not recorded", kind: input.kind, error: String(error) }));
  }
}

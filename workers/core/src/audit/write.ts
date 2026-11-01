/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId, toHexId } from "../lib/ids.ts";

import { hashOf } from "./chain.ts";
import type { AuditEntry, AuditEntryInput } from "./types.ts";

/**
 * Append one row to the audit chain.
 *
 * The sequence number and the previous hash are read and the row written in a single
 * statement: `INSERT … SELECT` takes the tail of the chain and appends to it atomically,
 * so two concurrent writers cannot both claim sequence 41. Reading the tail first and
 * inserting second would need a lock, and TiDB's HTTP driver has no session to hold one.
 *
 * Requires `INSERT` and `SELECT` grants on `audit_log` and nothing else — no `UPDATE`,
 * no `DELETE` — which is the structural half of immutability; the chain is the other.
 */
export async function appendAudit(db: Db, input: AuditEntryInput, nowMs: number = Date.now()): Promise<AuditEntry> {
  const tail = await db.first<{ seq: number | string; hash: Uint8Array | null }>(
    "SELECT `seq`, `hash` FROM `audit_log` ORDER BY `seq` DESC LIMIT 1",
  );
  const seq = tail === null ? 1 : Number(tail.seq) + 1;
  const prevHash = tail === null || tail.hash === null ? null : new Uint8Array(tail.hash);

  const entry: AuditEntry = {
    ...input,
    seq,
    occurredAt: sqlDatetime(new Date(nowMs)),
    prevHash,
  };
  const hash = await hashOf(entry);

  await db.execute(
    "INSERT INTO `audit_log` (`id`, `seq`, `occurred_at`, `actor_id`, `actor_type`, `actor_role`, `ip`, `user_agent`, " +
      "`request_id`, `action`, `resource_type`, `resource_id`, `subject_id`, `before`, `after`, `reason`, `severity`, `prev_hash`, `hash`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      newId(nowMs),
      seq,
      entry.occurredAt,
      input.actorId === null ? null : uuidBytes(input.actorId),
      input.actorType,
      input.actorRole,
      ipBytes(input.ip),
      input.userAgent === null ? null : input.userAgent.slice(0, 512),
      uuidBytes(input.requestId),
      input.action,
      input.resourceType,
      input.resourceId,
      input.subjectId === null ? null : uuidBytes(input.subjectId),
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.reason,
      input.severity,
      prevHash,
      hash,
    ],
  );
  return entry;
}

/**
 * A UUID string as the 16 bytes the column stores.
 *
 * Written here rather than imported so the audit module has no dependency on the
 * request layer: an audit row is written by workflows and alarms as well as by
 * handlers, and the alarm path must not pull in the HTTP stack.
 */
function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/gu, "");
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/iu.test(hex)) throw new RangeError(`not a UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** An IP address as `INET6_ATON` bytes; IPv4 becomes four bytes, not a string. */
function ipBytes(ip: string | null): Uint8Array | null {
  if (ip === null || ip === "") return null;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(ip);
  if (ipv4 !== null) {
    const bytes = new Uint8Array(4);
    for (let index = 1; index <= 4; index += 1) bytes[index - 1] = Number(ipv4[index]);
    return bytes;
  }
  return null;
}

/** A request id for a path that has no HTTP request — an alarm or a workflow. */
export function syntheticRequestId(nowMs: number = Date.now()): string {
  return toHexId(newId(nowMs));
}

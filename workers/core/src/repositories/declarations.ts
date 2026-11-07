/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { parseDatetime, sqlDatetime } from "../db/time.ts";
import { newId, toHexId } from "../lib/ids.ts";

/**
 * The declarations a rider makes about cash they cannot settle (`25 §7`, D148–D155).
 *
 * Extracted from `repositories/cash.ts` when that file passed the line budget: a settlement and a declaration are two
 * different records that happen to share a table's neighbourhood. A settlement is a claim about money the rider says
 * they sent; a declaration is a claim about the situation that stopped them. Both can lift the block, which is why they
 * live beside each other, and neither is the other's subtype, which is why they are now two files.
 */

/** A declaration a rider made about cash they could not settle (`25 §7`). */
export interface DeclarationRow {
  readonly id: Uint8Array;
  readonly kind: string;
  readonly note: string | null;
  /** When the lift a declaration granted ends; `null` on a path whose lift has no expiry, or on one that lifted nothing. */
  readonly liftedUntil: string | null;
  readonly routedToReview: boolean;
  readonly createdAt: string;
  /** When a human finished with the case, or `null` while it is still open (D155). */
  readonly resolvedAt: string | null;
}

/** The most recent declaration of a kind, which is what the cooldown is measured from. */
export async function lastDeclaration(db: Db, riderId: Uint8Array, kind: string): Promise<DeclarationRow | null> {
  const row = await db.first<Record<string, unknown>>(
    "SELECT `id`, `kind`, `note`, `lifted_until`, `routed_to_review`, `created_at` FROM `rider_cash_declarations` " +
      "WHERE `rider_id` = ? AND `kind` = ? ORDER BY `created_at` DESC LIMIT 1",
    [riderId, kind],
  );
  return row === null ? null : declarationOf(row);
}

/**
 * The lift a declaration currently grants, as the instant it ends — `null` when there is none.
 *
 * `lifted_until IS NULL` is ambiguous in the table and deliberately resolved here: a `ROBBED` declaration lifts the block
 * with no expiry, which reads as "lifted forever" rather than "not lifted". The query therefore selects rows with either
 * a null or a future expiry, and a null one is returned as `Infinity` by the caller's convention — see `activeLiftMs`.
 */
export async function activeLiftUntil(db: Db, riderId: Uint8Array, nowMs: number): Promise<number | null> {
  const row = await db.first<{ lifted_until: unknown }>(
    "SELECT `lifted_until` FROM `rider_cash_declarations` WHERE `rider_id` = ? " +
      "AND (`lifted_until` IS NULL OR `lifted_until` > ?) ORDER BY `lifted_until` IS NULL DESC, `created_at` DESC LIMIT 1",
    [riderId, sqlDatetime(new Date(nowMs))],
  );
  if (row === null) return null;
  if (row.lifted_until === null || row.lifted_until === undefined) return Number.POSITIVE_INFINITY;
  const parsed = parseDatetime(String(row.lifted_until));
  return parsed === null ? null : parsed.getTime();
}

/** One declaration as the driver returns it. */
function declarationOf(raw: Record<string, unknown>): DeclarationRow {
  return {
    id: raw["id"] instanceof Uint8Array ? raw["id"] : new Uint8Array(16),
    kind: String(raw["kind"] ?? ""),
    note: typeof raw["note"] === "string" ? raw["note"] : null,
    liftedUntil: typeof raw["lifted_until"] === "string" ? raw["lifted_until"] : null,
    routedToReview: Number(raw["routed_to_review"] ?? 0) === 1,
    createdAt: String(raw["created_at"] ?? ""),
    resolvedAt: typeof raw["resolved_at"] === "string" ? raw["resolved_at"] : null,
  };
}

/** What one declaration records. */
export interface DeclarationWrite {
  readonly riderId: Uint8Array;
  readonly kind: string;
  readonly note: string | null;
  /** The instant the lift ends, `null` for a lift with no expiry. */
  readonly liftedUntilMs: number | null;
  readonly routedToReview: boolean;
  /**
   * What the platform said the rider owed, frozen at the moment they disputed it (`25 §7`, D153).
   *
   * Both `null` on an emergency or a robbery: those declarations are not about a number, and a zero would read like one
   * that was checked.
   */
  readonly snapshotLinesPaisa?: number | null;
  readonly snapshotDifferencePaisa?: number | null;
}

/** Record a declaration and return its id. */
export async function writeDeclaration(db: Db, write: DeclarationWrite, nowMs: number): Promise<Uint8Array> {
  const id = newId(nowMs);
  await db.execute(
    "INSERT INTO `rider_cash_declarations` (`id`, `rider_id`, `kind`, `note`, `lifted_until`, `routed_to_review`, " +
      "`snapshot_lines_paisa`, `snapshot_difference_paisa`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      write.riderId,
      write.kind,
      write.note,
      write.liftedUntilMs === null ? null : sqlDatetime(new Date(write.liftedUntilMs)),
      write.routedToReview ? 1 : 0,
      write.snapshotLinesPaisa === undefined ? null : write.snapshotLinesPaisa,
      write.snapshotDifferencePaisa === undefined ? null : write.snapshotDifferencePaisa,
      sqlDatetime(new Date(nowMs)),
    ],
  );
  return id;
}

/** One declaration a reviewer has to read, with the rider it belongs to. */
export interface DeclarationQueueRow {
  readonly id: string;
  readonly riderId: string;
  readonly riderName: string | null;
  readonly riderCode: string | null;
  readonly kind: string;
  readonly note: string | null;
  /** The balance at the moment of the declaration, which is what a dispute is about. */
  readonly outstandingPaisa: number;
  readonly snapshotLinesPaisa: number | null;
  readonly snapshotDifferencePaisa: number | null;
  readonly createdAt: string;
}

/**
 * The declarations waiting for a human, newest first (`25 §7`, D154).
 *
 * Newest first, unlike the settlement queue's oldest-first, because the two queues answer different questions. A
 * settlement's age is a countdown — past two hours the platform releases the rider anyway (D142) — so the oldest is the
 * urgent one. A declaration has already lifted the block: nothing gets worse by waiting an hour, and a robbery reported
 * ten minutes ago is more urgent than one reported yesterday and already being handled. The sort is
 * `routed_to_review DESC, created_at DESC` through the index that was created for it.
 *
 * The rider's balance comes along because it is the other half of a dispute: the snapshot says what the platform claimed
 * then, and this says what it claims now.
 */
export async function reviewDeclarations(db: Db, limit: number): Promise<DeclarationQueueRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT d.`id`, d.`rider_id`, r.`full_name`, r.`code`, d.`kind`, d.`note`, b.`outstanding_paisa`, " +
      "d.`snapshot_lines_paisa`, d.`snapshot_difference_paisa`, d.`created_at` FROM `rider_cash_declarations` d " +
      "JOIN `riders` r ON r.`id` = d.`rider_id` LEFT JOIN `rider_cash_balances` b ON b.`rider_id` = d.`rider_id` " +
      "WHERE d.`routed_to_review` = 1 ORDER BY d.`created_at` DESC LIMIT ?",
    [limit],
  );
  return rows.map((raw) => ({
    id: raw["id"] instanceof Uint8Array ? toHexId(raw["id"]) : "",
    riderId: raw["rider_id"] instanceof Uint8Array ? toHexId(raw["rider_id"]) : "",
    riderName: typeof raw["full_name"] === "string" ? raw["full_name"] : null,
    riderCode: typeof raw["code"] === "string" ? raw["code"] : null,
    kind: String(raw["kind"] ?? ""),
    note: typeof raw["note"] === "string" ? raw["note"] : null,
    outstandingPaisa: Number(raw["outstanding_paisa"] ?? 0),
    snapshotLinesPaisa: raw["snapshot_lines_paisa"] === null || raw["snapshot_lines_paisa"] === undefined ? null : Number(raw["snapshot_lines_paisa"]),
    snapshotDifferencePaisa:
      raw["snapshot_difference_paisa"] === null || raw["snapshot_difference_paisa"] === undefined
        ? null
        : Number(raw["snapshot_difference_paisa"]),
    createdAt: String(raw["created_at"] ?? ""),
  }));
}

/**
 * Close a declaration, once.
 *
 * `resolved_at IS NULL` in the predicate is what makes a case close once: two reviewers with the same dispute open on
 * two screens cannot both write it off, and the loser is told the case is already resolved rather than posting a second
 * adjustment. The same guard makes a retry safe after a failure that never reached this statement.
 */
export async function resolveDeclaration(
  db: Db,
  id: Uint8Array,
  resolvedBy: Uint8Array,
  note: string | null,
  nowMs: number,
): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `rider_cash_declarations` SET `resolved_at` = ?, `resolved_by` = ?, `resolution_note` = ? " +
      "WHERE `id` = ? AND `resolved_at` IS NULL",
    [sqlDatetime(new Date(nowMs)), resolvedBy, note, id],
  );
  return result.affectedRows > 0;
}

/** One declaration by id, for a write-off that names the case it closes. */
export async function declarationById(db: Db, id: Uint8Array): Promise<DeclarationRow | null> {
  const row = await db.first<Record<string, unknown>>(
    "SELECT `id`, `kind`, `note`, `lifted_until`, `routed_to_review`, `created_at`, `resolved_at` FROM " +
      "`rider_cash_declarations` WHERE `id` = ? LIMIT 1",
    [id],
  );
  return row === null ? null : { ...declarationOf(row), resolvedAt: row["resolved_at"] === null ? null : String(row["resolved_at"]) };
}

/**
 * One declaration read back in full, with the rider it belongs to and the decision that ended it (`25 §7`, D156).
 *
 * The queue answers "what needs attention"; this answers "what happened here" — for a reviewer opening a case from a
 * link, for support reading it beside a rider on the phone, and for the audit that comes later. `open` is derived from
 * `resolved_at` rather than from the balance, because a write-off that clears the debt and a case closed without one are
 * two different endings and the balance cannot tell them apart.
 *
 * The rider's phone travels with the case because `§7` promises somebody will ring them back after a robbery; a case
 * record that cannot produce a number is a record that stalls at the first step.
 */
export interface DeclarationCase {
  readonly id: string;
  readonly kind: string;
  readonly note: string | null;
  readonly createdAt: string;
  /** When the lift ends, `null` for a lift with no expiry or none at all. */
  readonly liftedUntil: string | null;
  readonly routedToReview: boolean;
  /** `false` once a human has finished with it, whatever they decided. */
  readonly open: boolean;
  readonly snapshotLinesPaisa: number | null;
  readonly snapshotDifferencePaisa: number | null;
  readonly riderId: string;
  readonly riderName: string | null;
  readonly riderCode: string | null;
  readonly riderPhone: string | null;
  /** What the platform claims the rider owes now, which is what a reviewer decides against. */
  readonly outstandingPaisa: number;
  readonly resolvedAt: string | null;
  /** The admin who closed it, by display name — the id is in the audit row. */
  readonly resolvedByName: string | null;
  readonly resolutionNote: string | null;
}

/** One case by id, or `null` when the id names nothing. */
export async function declarationCase(db: Db, id: Uint8Array): Promise<DeclarationCase | null> {
  const raw = await db.first<Record<string, unknown>>(
    "SELECT d.`id`, d.`rider_id`, r.`full_name`, r.`code`, u.`phone`, d.`kind`, d.`note`, d.`lifted_until`, " +
      "d.`routed_to_review`, d.`snapshot_lines_paisa`, d.`snapshot_difference_paisa`, d.`created_at`, d.`resolved_at`, " +
      "d.`resolution_note`, p.`display_name` AS resolved_by_name, b.`outstanding_paisa` " +
      "FROM `rider_cash_declarations` d JOIN `riders` r ON r.`id` = d.`rider_id` " +
      "JOIN `users` u ON u.`id` = r.`user_id` " +
      "LEFT JOIN `user_profiles` p ON p.`user_id` = d.`resolved_by` " +
      "LEFT JOIN `rider_cash_balances` b ON b.`rider_id` = d.`rider_id` " +
      "WHERE d.`id` = ? LIMIT 1",
    [id],
  );
  if (raw === null) return null;
  const paisa = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);
  return {
    id: raw["id"] instanceof Uint8Array ? toHexId(raw["id"]) : "",
    kind: String(raw["kind"] ?? ""),
    note: typeof raw["note"] === "string" ? raw["note"] : null,
    createdAt: String(raw["created_at"] ?? ""),
    liftedUntil: typeof raw["lifted_until"] === "string" ? raw["lifted_until"] : null,
    routedToReview: Number(raw["routed_to_review"] ?? 0) === 1,
    open: raw["resolved_at"] === null || raw["resolved_at"] === undefined,
    snapshotLinesPaisa: paisa(raw["snapshot_lines_paisa"]),
    snapshotDifferencePaisa: paisa(raw["snapshot_difference_paisa"]),
    riderId: raw["rider_id"] instanceof Uint8Array ? toHexId(raw["rider_id"]) : "",
    riderName: typeof raw["full_name"] === "string" ? raw["full_name"] : null,
    riderCode: typeof raw["code"] === "string" ? raw["code"] : null,
    riderPhone: typeof raw["phone"] === "string" ? raw["phone"] : null,
    outstandingPaisa: Number(raw["outstanding_paisa"] ?? 0),
    resolvedAt: typeof raw["resolved_at"] === "string" ? raw["resolved_at"] : null,
    resolvedByName: typeof raw["resolved_by_name"] === "string" ? raw["resolved_by_name"] : null,
    resolutionNote: typeof raw["resolution_note"] === "string" ? raw["resolution_note"] : null,
  };
}

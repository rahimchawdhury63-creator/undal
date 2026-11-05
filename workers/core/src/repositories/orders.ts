/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { classifyError } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import type { OrderState } from "../domain/order/states.ts";

/**
 * Reading and moving orders, in SQL that the domain never sees.
 *
 * The split matters: `domain/order/state-machine.ts` decides whether a move is legal, and this
 * module performs it — with the state in the `WHERE` clause. That clause is the concurrency
 * control: two requests racing to accept the same order cannot both succeed, and the loser gets
 * `applied: false` instead of a silent overwrite. As `05 §6.1` requires, that beats an
 * interactive transaction on an HTTP driver.
 */

/** The columns every order response is built from. */
export interface OrderRow {
  readonly id: Uint8Array;
  readonly code: string;
  readonly customer_user_id: Uint8Array;
  readonly vendor_id: Uint8Array;
  readonly zone_id: Uint8Array;
  readonly fulfilment: string;
  readonly state: OrderState;
  readonly pickup_lat_e7: number | string;
  readonly pickup_lon_e7: number | string;
  readonly subtotal_paisa: number | string;
  readonly discount_paisa: number | string;
  readonly delivery_fee_paisa: number | string;
  readonly small_order_fee_paisa: number | string;
  readonly tax_paisa: number | string;
  readonly tip_paisa: number | string;
  readonly rounding_paisa: number | string;
  readonly total_paisa: number | string;
  readonly cash_collected_paisa: number | string | null;
  readonly commission_paisa: number | string;
  readonly rider_bonus_paisa: number | string;
  readonly rider_payout_paisa: number | string;
  readonly vendor_payout_paisa: number | string;
  readonly surge_bps: number | string;
  readonly prep_time_s: number | string | null;
  readonly rider_id: Uint8Array | null;
  readonly customer_note: string | null;
  readonly placed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const COLUMNS =
  "`id`, `code`, `customer_user_id`, `vendor_id`, `zone_id`, `fulfilment`, `state`, `pickup_lat_e7`, " +
  "`pickup_lon_e7`, `subtotal_paisa`, " +
  "`discount_paisa`, `delivery_fee_paisa`, `small_order_fee_paisa`, `tax_paisa`, `tip_paisa`, " +
  "`rounding_paisa`, `total_paisa`, `cash_collected_paisa`, `commission_paisa`, `rider_bonus_paisa`, " +
  "`rider_payout_paisa`, `vendor_payout_paisa`, `surge_bps`, `prep_time_s`, `rider_id`, " +
  "`customer_note`, `placed_at`, `created_at`, `updated_at`";

/** One order by id. */
export async function findOrder(db: Db, orderId: Uint8Array): Promise<OrderRow | null> {
  return db.first<OrderRow>(`SELECT ${COLUMNS} FROM \`orders\` WHERE \`id\` = ?`, [orderId]);
}

/**
 * One order by its public code.
 *
 * The stream's channel id is the code a customer reads aloud (`08 §9`), not the UUID, so the
 * order-authorization answer arrives as a code and is looked up here. `code` is uniquely indexed
 * (`06 §3`), which is what makes one row the right answer rather than "the first of several".
 */
export async function findOrderByCode(db: Db, code: string): Promise<OrderRow | null> {
  return db.first<OrderRow>(`SELECT ${COLUMNS} FROM \`orders\` WHERE \`code\` = ?`, [code]);
}

/** The next event sequence number for an order, which is per order and starts at 1. */
export async function nextEventSeq(db: Db, orderId: Uint8Array): Promise<number> {
  const row = await db.first<{ last: number | string | null }>(
    "SELECT MAX(`seq`) AS last FROM `order_state_events` WHERE `order_id` = ?",
    [orderId],
  );
  return Number(row?.last ?? 0) + 1;
}

/**
 * How many times an append may take a fresh sequence before the failure is the caller's.
 *
 * Five is not a guess at a contention level: the only way to lose the race twice is for two other transitions
 * to allocate the same number twice in the microseconds between a `MAX` and an `INSERT`, and by the third
 * attempt the alternative explanation — a genuinely reused event id — has to be the answer.
 */
export const MAX_EVENT_APPEND_ATTEMPTS = 5;

/** The event row, appended once with the sequence it was given. */
const INSERT_EVENT =
  "INSERT INTO `order_state_events` (`id`, `order_id`, `seq`, `from_state`, `to_state`, `actor`, " +
  "`actor_user_id`, `event`, `reason_code`, `reason_text`, `metadata`, `occurred_at`, `created_at`) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/** What an appended event needs. */
export interface EventAppendInput {
  readonly orderId: Uint8Array;
  readonly eventId: Uint8Array;
  readonly from: OrderState;
  readonly to: OrderState;
  readonly actor: string;
  readonly actorUserId: Uint8Array | null;
  readonly event: string;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  readonly now: string;
}

/**
 * Append the event row and return the sequence it got (D102).
 *
 * `MAX(seq)+1` then `INSERT` is two statements, so two transitions on one order can read the same maximum. The
 * unique index `(order_id, seq)` then refuses the second insert — but by then the order's `state` has already
 * moved, because the `UPDATE` is what won the race. Losing the append there would leave an order that changed
 * state with no event to explain it, and an error to the caller who caused a change that did happen.
 *
 * So a `DUPLICATE` is not a failure: it is the index saying "somebody took that number", and the answer is to
 * take the next one. Everything else — a lock timeout, a dead connection — is rethrown, because retrying those
 * here would hide the real failure behind an event row that never appears.
 */
export async function appendEvent(db: Db, input: EventAppendInput): Promise<number> {
  for (let attempt = 1; attempt <= MAX_EVENT_APPEND_ATTEMPTS; attempt += 1) {
    const seq = await nextEventSeq(db, input.orderId);
    try {
      await db.execute(INSERT_EVENT, [
        input.eventId,
        input.orderId,
        seq,
        input.from,
        input.to,
        input.actor,
        input.actorUserId,
        input.event,
        input.reasonCode,
        input.reasonText,
        "{}",
        input.now,
        input.now,
      ]);
      return seq;
    } catch (error) {
      if (classifyError(error) !== "DUPLICATE" || attempt === MAX_EVENT_APPEND_ATTEMPTS) throw error;
    }
  }
  // Unreachable: the loop either returns a sequence or throws on its last attempt.
  throw new RangeError(`could not allocate an event sequence for order ${String(input.orderId)}`);
}

/** The result of attempting a state move. */
export interface MoveResult {
  /** Whether this request won the race and the row now holds the new state. */
  readonly applied: boolean;
  /** The sequence number the event was written with, when it applied. */
  readonly seq: number;
}

/**
 * Move an order from one state to another, and append the event.
 *
 * The `UPDATE … WHERE state = ?` is the entire concurrency story: an order accepted a millisecond
 * ago by another request no longer matches, affects zero rows, and this returns `applied: false`
 * rather than writing a second event. `updated_at` is set explicitly because the schema has no
 * triggers (`06 §1`), so a forgotten `updated_at` is a row that lies about when it changed.
 */
export async function moveState(
  db: Db,
  input: {
    readonly orderId: Uint8Array;
    readonly eventId: Uint8Array;
    readonly from: OrderState;
    readonly to: OrderState;
    readonly actor: string;
    /** `null` for a `SYSTEM` actor — an alarm has no user, and the column allows it. */
    readonly actorUserId: Uint8Array | null;
    readonly event: string;
    readonly reasonCode: string | null;
    readonly reasonText: string | null;
    readonly nowMs: number;
    readonly extra?: Readonly<Record<string, string | number | null | Uint8Array>>;
  },
): Promise<MoveResult> {
  const now = sqlDatetime(new Date(input.nowMs));
  const assignments = ["`state` = ?", "`updated_at` = ?"];
  const values: unknown[] = [input.to, now];
  for (const [column, value] of Object.entries(input.extra ?? {})) {
    assignments.push(`\`${column}\` = ?`);
    values.push(value);
  }
  values.push(input.orderId, input.from);

  const updated = await db.execute(
    `UPDATE \`orders\` SET ${assignments.join(", ")} WHERE \`id\` = ? AND \`state\` = ?`,
    values,
  );
  if (updated.affectedRows !== 1) return { applied: false, seq: 0 };

  const seq = await appendEvent(db, {
    orderId: input.orderId,
    eventId: input.eventId,
    from: input.from,
    to: input.to,
    actor: input.actor,
    actorUserId: input.actorUserId,
    event: input.event,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
    now,
  });
  return { applied: true, seq };
}

/** The orders a customer or vendor should see, newest first. */
export async function listOrders(
  db: Db,
  filter: { readonly customerUserId?: Uint8Array; readonly vendorId?: Uint8Array; readonly limit: number },
): Promise<OrderRow[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(filter.limit)), 100);
  if (filter.customerUserId !== undefined) {
    return db.query<OrderRow>(
      `SELECT ${COLUMNS} FROM \`orders\` WHERE \`customer_user_id\` = ? ORDER BY \`created_at\` DESC LIMIT ?`,
      [filter.customerUserId, bounded],
    );
  }
  if (filter.vendorId !== undefined) {
    return db.query<OrderRow>(
      `SELECT ${COLUMNS} FROM \`orders\` WHERE \`vendor_id\` = ? ORDER BY \`created_at\` DESC LIMIT ?`,
      [filter.vendorId, bounded],
    );
  }
  throw new RangeError("listOrders: one of customerUserId or vendorId is required");
}

/** The vendor a user owns, if any. */
export async function vendorForUser(db: Db, userId: Uint8Array): Promise<{ id: Uint8Array; status: string; open_state: string } | null> {
  return db.first<{ id: Uint8Array; status: string; open_state: string }>(
    "SELECT `id`, `status`, `open_state` FROM `vendors` WHERE `owner_user_id` = ? LIMIT 1",
    [userId],
  );
}

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Riders, as an operator reads them.
 *
 * `riders.ts` answers the questions a rider asks about themselves: is my shift open, what do I owe,
 * when is my cash due. This file answers the questions a fleet supervisor asks at 21:00: who is
 * online, who is locked for cash, who has been sitting in `CASH_LOCKED` since last night. The cash
 * balance is joined rather than fetched per row, because a list of forty riders must not become
 * forty-one statements.
 */

import type { Db } from "../db/client.ts";

/** The columns an operator's list and detail both show. */
export const ADMIN_RIDER_COLUMNS =
  "r.`id`, r.`code`, r.`full_name`, r.`vehicle`, r.`home_zone_id`, r.`status`, r.`shift_state`, " +
  "r.`payout_method`, r.`approved_at`, r.`created_at`, r.`updated_at`, " +
  "COALESCE(b.`outstanding_paisa`, 0) AS `outstanding_paisa`";

/** The join that carries the cash balance onto a rider row. */
const BALANCE_JOIN = "LEFT JOIN `rider_cash_balances` b ON b.`rider_id` = r.`id`";

/** One rider row as an operator sees it. */
export interface AdminRiderRow {
  readonly id: Uint8Array;
  readonly code: string;
  readonly full_name: string;
  readonly vehicle: string;
  readonly home_zone_id: Uint8Array;
  readonly status: string;
  readonly shift_state: string;
  readonly payout_method: string;
  readonly approved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly outstanding_paisa: number | string;
}

/** The onboarding statuses a rider can be in. */
export const RIDER_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
  "RETIRED",
] as const;

/** One of the eight. */
export type RiderStatus = (typeof RIDER_STATUSES)[number];

/** Whether a string is one of the eight. */
export function isRiderStatus(value: unknown): value is RiderStatus {
  return typeof value === "string" && (RIDER_STATUSES as readonly string[]).includes(value);
}

/** The shift states a rider can be in. */
export const RIDER_SHIFT_STATES = ["OFFLINE", "VERIFYING", "ONLINE", "ON_ORDER", "BREAK", "CASH_LOCKED"] as const;

/** One of the six. */
export type RiderShiftState = (typeof RIDER_SHIFT_STATES)[number];

/** Whether a string is one of the six. */
export function isRiderShiftState(value: unknown): value is RiderShiftState {
  return typeof value === "string" && (RIDER_SHIFT_STATES as readonly string[]).includes(value);
}

/** What an operator may narrow the fleet list by. */
export interface AdminRiderFilter {
  readonly status: RiderStatus | null;
  readonly shiftState: RiderShiftState | null;
  readonly q: string | null;
  readonly zoneId: Uint8Array | null;
  readonly cursor: { readonly createdAt: string; readonly id: Uint8Array } | null;
  readonly limit: number;
}

/** Escape the wildcards a supervisor could type into a search box. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/**
 * One page of riders, newest first.
 *
 * The same keyset discipline as every other operator list: a rider approved while somebody is
 * paging must not shift the rows under them, and the id breaks ties on `created_at`.
 */
export async function listAdminRiders(db: Db, filter: AdminRiderFilter): Promise<AdminRiderRow[]> {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];

  if (filter.status !== null) {
    where.push("r.`status` = ?");
    params.push(filter.status);
  }
  if (filter.shiftState !== null) {
    where.push("r.`shift_state` = ?");
    params.push(filter.shiftState);
  }
  if (filter.zoneId !== null) {
    where.push("r.`home_zone_id` = ?");
    params.push(filter.zoneId);
  }
  if (filter.q !== null && filter.q.trim() !== "") {
    where.push("(r.`full_name` LIKE ? OR r.`code` LIKE ?)");
    const pattern = `%${escapeLike(filter.q.trim())}%`;
    params.push(pattern, pattern);
  }
  if (filter.cursor !== null) {
    where.push("(r.`created_at` < ? OR (r.`created_at` = ? AND r.`id` < ?))");
    params.push(filter.cursor.createdAt, filter.cursor.createdAt, filter.cursor.id);
  }

  params.push(filter.limit);
  return db.query<AdminRiderRow>(
    `SELECT ${ADMIN_RIDER_COLUMNS} FROM \`riders\` r ${BALANCE_JOIN} WHERE ${where.join(" AND ")} ` +
      "ORDER BY r.`created_at` DESC, r.`id` DESC LIMIT ?",
    params,
  );
}

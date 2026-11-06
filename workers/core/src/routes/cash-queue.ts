/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { parseDatetime } from "../db/time.ts";
import { pendingSettlements } from "../repositories/cash.ts";
import { AUTO_LIFT_MS, autoLiftDue } from "../domain/rider/cash.ts";

/**
 * The reviewer's queue: the list the decisions in `cash-review.ts` are made from (D145–D146).
 *
 * A read surface rather than a decision, and therefore its own module: the file it was born in had grown to carry a
 * queue, three decisions and the doc comments that justify them, and the line budget in `scripts/guardrails` is the
 * mechanism that stops a route file from becoming a place where nobody looks for anything.
 */

/** The queue's ceiling. A pending list longer than this is an incident, not a page to scroll. */
const QUEUE_LIMIT_MAX = 100;

/** One claim as the reviewer's list shows it. */
function queueEntry(row: Awaited<ReturnType<typeof pendingSettlements>>[number], nowMs: number): Record<string, unknown> {
  const submitted = parseDatetime(row.submittedAt);
  const ageMs = submitted === null ? null : nowMs - submitted.getTime();
  return {
    id: row.id,
    rider: { id: row.riderId, name: row.riderName, code: row.riderCode },
    amountPaisa: row.amountPaisa,
    method: row.method,
    trxId: row.trxId,
    submittedAt: row.submittedAt,
    ageMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
    // The reviewer's deadline, shown rather than implied: past it, the door will open without them (D142).
    reviewDueBy: submitted === null ? null : new Date(submitted.getTime() + AUTO_LIFT_MS).toISOString(),
    slaBreached: autoLiftDue(submitted === null ? null : submitted.getTime(), nowMs),
    // An escalated claim is still in the queue — nobody has decided whether the money arrived — but it is a different
    // kind of wait: the rider is already released, and the next reviewer inherits somebody else's note (D146).
    escalated: row.escalatedAt !== null,
    escalationNote: row.escalationNote,
    numberMatches: row.numberMatches,
    nameMatches: row.nameMatches,
    screenshotUrl: row.screenshotUrl,
    selfieUrl: row.selfieUrl,
  };
}

/**
 * The reviewer's queue: `GET /v1/finance/cash/settlements` (D145).
 *
 * `25 §6` draws a screen that opens with "7 pending · SLA 30 min" and a list ordered by how long each claim has waited.
 * Without a route behind it, D143's approve and D144's reject were buttons on a screen with no list: a reviewer could
 * decide a settlement only if they already knew its id, which is not a queue, it is a lookup.
 *
 * Oldest first, because the ordering is the fairness rule — the top of the list is the claim closest to auto-lifting
 * without review. Each row carries the two automated flags and both evidence URLs from `§6`'s table, so the decision is
 * made from the list rather than by fetching each claim. `slaBreached` is the same two-hour rule D142 enforces at the
 * door, computed here rather than stored, so the queue and the gate can never disagree about who is late.
 *
 * The summary is what the header shows, and it is deliberately three numbers rather than a dashboard: how many are
 * waiting, how old the oldest is, and how many are past the deadline they will be released at anyway.
 */
async function settlementQueue(ctx: Ctx): Promise<Response> {
  const requested = Number(ctx.url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), QUEUE_LIMIT_MAX) : 50;
  const nowMs = Date.now();
  const rows = await pendingSettlements(ctx.db, limit);
  const entries = rows.map((row) => queueEntry(row, nowMs));
  const ages = entries.map((entry) => entry["ageMinutes"]).filter((age): age is number => typeof age === "number");
  return successResponse(
    {
      settlements: entries,
      summary: {
        pending: entries.length,
        oldestMinutes: ages.length === 0 ? null : Math.max(...ages),
        breaches: entries.filter((entry) => entry["slaBreached"] === true).length,
        limit,
      },
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The reviewer's queue route (`08 §8`, D145). */
export const CASH_QUEUE_ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/finance/cash/settlements",
    permission: "finance.cash.list_outstanding",
    // `ADMIN_WRITE` is the only admin-facing group in the limiter (`29 §4`); a read that shares a reviewer's budget
    // with their decisions is the honest accounting, since both are one person at one screen.
    group: "ADMIN_WRITE",
    run: async (ctx) => settlementQueue(ctx),
  },
];

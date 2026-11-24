/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { parseDatetime, sqlDatetime } from "../db/time.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import { settlementsForReview, type SettlementFilter, type SettlementState } from "../repositories/cash.ts";
import { reviewDeclarations, type DeclarationFilter, type DeclarationState } from "../repositories/declarations.ts";
import { AUTO_LIFT_MS, autoLiftDue, isDeclarationKind } from "../domain/rider/cash.ts";

/**
 * The reviewer's queue: the list the decisions in `cash-review.ts` are made from (D145–D146).
 *
 * A read surface rather than a decision, and therefore its own module: the file it was born in had grown to carry a
 * queue, three decisions and the doc comments that justify them, and the line budget in `scripts/guardrails` is the
 * mechanism that stops a route file from becoming a place where nobody looks for anything.
 */

/** The queue's ceiling. A pending list longer than this is an incident, not a page to scroll. */
const QUEUE_LIMIT_MAX = 100;

/** The rails a settlement can arrive on — `005`'s `CHECK` constraint, which is the only place this list may come from. */
const SETTLEMENT_METHODS: readonly string[] = ["BKASH", "NAGAD", "CASH_TO_OPS"];

/** One claim as the reviewer's list shows it. */
function queueEntry(row: Awaited<ReturnType<typeof settlementsForReview>>[number], nowMs: number): Record<string, unknown> {
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
    // A part-payment (`25 §7`, D151) is a claim whose amount is deliberately below the balance: the reviewer should
    // read that as a choice before approving it, not as a short transfer.
    partial: row.isPartial,
    escalated: row.escalatedAt !== null,
    escalationNote: row.escalationNote,
    numberMatches: row.numberMatches,
    nameMatches: row.nameMatches,
    screenshotUrl: row.screenshotUrl,
    selfieUrl: row.selfieUrl,
    // The decided half of the queue (D158). `status` is always present; the rest is null while a claim is pending, and
    // a reviewer reading a closed case needs all four to say what happened without a second request.
    status: row.status,
    confirmedAt: row.confirmedAt,
    rejectionReason: row.rejectionReason,
    approvedPaisa: row.approvedPaisa,
  };
}

/**
 * The reviewer's queue: `GET /v1/finance/cash/settlements` (D145 — filtered and paged in D158).
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
 * **`?state=` is the question the screen could not ask (D158).** Only `PENDING` was ever listed, so "what happened to
 * the settlement this rider is ringing about?" had no route; `decided` lists the `CONFIRMED` and `REJECTED` half, and
 * each row then carries the reason and the amount actually released. `?method=` narrows to one rail, `?partial=` to the
 * part-payments of `§7`, `?riderId=` to one rider, and `?breach=true` to the claims already past D142's deadline — the
 * filter a supervisor wants at 21:00, when the question is not "what is waiting" but "what has been waiting too long".
 *
 * **Paged by keyset in the direction the order runs.** The cursor resumes after a `(created_at, id)` pair, so the next
 * page is *greater* than the cursor — the comparison flips with the sort, which is why the declarations queue's `<`
 * could not simply be copied (D157).
 *
 * The summary is what the header shows, and it is deliberately three numbers rather than a dashboard: how many are
 * waiting, how old the oldest is, and how many are past the deadline they will be released at anyway.
 */
async function settlementQueue(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;
  const requested = Number(params.get("limit") ?? 50);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), QUEUE_LIMIT_MAX) : 50;

  const rawState = params.get("state") ?? "pending";
  if (rawState !== "pending" && rawState !== "decided" && rawState !== "all") return refusal(ctx, { field: "state" });
  const state = rawState as SettlementState;

  const rawMethod = params.get("method");
  if (rawMethod !== null && !SETTLEMENT_METHODS.includes(rawMethod.toUpperCase())) {
    return refusal(ctx, { field: "method" });
  }
  const method = rawMethod === null ? null : rawMethod.toUpperCase();

  const rawPartial = params.get("partial");
  if (rawPartial !== null && rawPartial !== "true" && rawPartial !== "false") {
    return refusal(ctx, { field: "partial" });
  }
  const partial = rawPartial === null ? null : rawPartial === "true";

  const rawBreach = params.get("breach");
  if (rawBreach !== null && rawBreach !== "true" && rawBreach !== "false") {
    return refusal(ctx, { field: "breach" });
  }

  const rawRider = params.get("riderId");
  let riderId: Uint8Array | null = null;
  if (rawRider !== null) {
    try {
      riderId = uuidBytes(rawRider);
    } catch {
      return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "riderId" }, ctx.locale, ctx.requestId);
    }
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && cursor === null) return refusal(ctx, { field: "cursor" });

  const nowMs = Date.now();
  // `breach=true` is the same arithmetic the row's flag does, pushed into the statement so the page is entirely late
  // claims rather than a page that happens to contain some.
  const breachingBefore = rawBreach === "true" ? sqlDatetime(new Date(nowMs - AUTO_LIFT_MS)) : null;
  const filter: SettlementFilter = { state, method, riderId, partial, breachingBefore, cursor, limit };
  const rows = await settlementsForReview(ctx.db, filter);
  const entries = rows.map((row) => queueEntry(row, nowMs));
  const ages = entries.map((entry) => entry["ageMinutes"]).filter((age): age is number => typeof age === "number");
  const last = rows[rows.length - 1];
  return successResponse(
    {
      settlements: entries,
      summary: {
        // Of this page: `pending` on the default view, but the same slot on `decided` would be a lie, so it is named
        // after what it counts rather than after what it usually contains.
        total: entries.length,
        pending: entries.filter((entry) => entry["status"] === "PENDING").length,
        oldestMinutes: ages.length === 0 ? null : Math.max(...ages),
        breaches: entries.filter((entry) => entry["slaBreached"] === true).length,
        limit,
        state,
        method,
      },
      nextCursor: rows.length === limit && last !== undefined ? encodeCursor(last.submittedAt, last.id) : null,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** One refusal the query string can earn: which parameter, and how to fix it. */
type QueryRefusal = { readonly field: string };

/**
 * The declarations a human owes an answer to: `GET /v1/finance/cash/declarations` (D154, paged and filtered in D157).
 *
 * `25 §7` lifts the block for every declaration, so a robbery and a dispute are both *already* handled as far as the
 * rider is concerned — and until this route existed, nothing told the platform that a case had been opened. The rows are
 * the three kinds the section names, newest first, each with the rider, their sentence, the balance now, and (for a
 * dispute) the arithmetic as it stood when they objected.
 *
 * **The list is the open cases, and it says so (D157).** D154 listed every routed declaration forever, so a case
 * written off under D155 sat on the morning's list being re-decided. `state` picks a half — `open` by default,
 * `resolved` for the history, `all` for the audit — and `kind` narrows to one of the three buttons. `riderId` answers
 * the question support actually asks: "what has this rider declared".
 *
 * **Paged by keyset, not by offset.** `nextCursor` is returned only when the page was full, because an empty cursor on a
 * short page is a client's cue to stop and a full page is the only case where another one might exist. A declaration
 * arriving mid-paging cannot duplicate or skip a row, which is the failure `OFFSET` produces on any list sorted newest
 * first.
 *
 * The two numbers on a dispute are shown side by side on purpose: `snapshotDifferencePaisa` is what the rider was looking
 * at — the bug report — and `outstandingPaisa` is what the platform says today. A reviewer deciding anything needs both,
 * and a queue that showed only one would let a fixed bug look like an unfixed one, or the reverse.
 */
async function declarationQueue(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;
  const requested = Number(params.get("limit") ?? 50);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), QUEUE_LIMIT_MAX) : 50;

  const rawKind = params.get("kind");
  if (rawKind !== null && !isDeclarationKind(rawKind.toUpperCase())) return refusal(ctx, { field: "kind" });
  const kind = rawKind === null ? null : rawKind.toUpperCase();

  const rawState = params.get("state") ?? "open";
  if (rawState !== "open" && rawState !== "resolved" && rawState !== "all") return refusal(ctx, { field: "state" });
  const state = rawState as DeclarationState;

  const rawRider = params.get("riderId");
  let riderId: Uint8Array | null = null;
  if (rawRider !== null) {
    try {
      riderId = uuidBytes(rawRider);
    } catch {
      return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "riderId" }, ctx.locale, ctx.requestId);
    }
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && cursor === null) return refusal(ctx, { field: "cursor" });

  const filter: DeclarationFilter = { kind, state, riderId, cursor, limit };
  const rows = await reviewDeclarations(ctx.db, filter);
  const last = rows[rows.length - 1];
  return successResponse(
    {
      declarations: rows,
      summary: {
        // Counts are of this page, not of the queue: a summary that claimed otherwise would need a second statement
        // per request to report a number the client cannot act on without fetching the rest anyway.
        total: rows.length,
        robberies: rows.filter((row) => row.kind === "ROBBED").length,
        disputes: rows.filter((row) => row.kind === "DISPUTE").length,
        emergencies: rows.filter((row) => row.kind === "EMERGENCY").length,
        limit,
        state,
        kind,
      },
      nextCursor: rows.length === limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** A `422` that names the parameter the caller has to fix. */
function refusal(ctx: Ctx, details: QueryRefusal): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details }, ctx.locale, ctx.requestId);
}

/** The reviewer's queue routes (`08 §8`, D145–D154). */
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
  {
    method: "GET",
    path: "/v1/finance/cash/declarations",
    // The same key as the settlement queue: one reviewer, one surface, two lists.
    permission: "finance.cash.list_outstanding",
    group: "ADMIN_WRITE",
    run: async (ctx) => declarationQueue(ctx),
  },
];

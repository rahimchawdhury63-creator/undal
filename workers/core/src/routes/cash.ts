/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { toHexId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { parseDatetime } from "../db/time.ts";
import { cashDueAtMs, cashOutstandingPaisa, findRiderByUserId, type RiderRow } from "../repositories/riders.ts";
import {
  lastShiftId,
  latestSettlement,
  payoutIdentity,
  pendingSettlement,
  settlementByTrx,
  writeSettlement,
  type SettlementRow,
} from "../repositories/cash.ts";
import { checkClaim, parseSettlement } from "../domain/rider/cash.ts";

/**
 * The rider's cash: the balance they are blocked on, and the settlement they submit to clear it (`25`, D140–D141).
 *
 * Two routes, because they are two halves of one screen. `GET /v1/rider/cash` is the number and the state — readable
 * *without* being blocked on, which matters because the blocking screen is the most coercive surface in the platform.
 * `POST /v1/rider/cash/settle` is the submission: five fields the rider types after sending money by bKash, stored as a
 * `PENDING` row for a human to confirm.
 *
 * **Submission does not unlock anything.** `25 §5` has the rider's state become `CASH_SUBMITTED` on success, and this
 * build has no such state: `riders.shift_state` offers six values and the block is released by *approval*, not by a
 * claim. Pretending otherwise would let a rider past the gate by typing ten characters, which is the one thing the
 * screen exists to prevent. What changes at submission is that the screen stops asking: the app shows "submitted at
 * 20:41, waiting for confirmation" and the rider may close the app.
 *
 * **The evidence is the claim plus the platform's two checks.** `25 §6` compares the typed number and name to what is on
 * file; both are flags for a reviewer and neither refuses the rider, because the alternative is a rider whose number
 * changed last week trapped behind a screen they cannot pass. A refusal code exists for the one thing that is
 * unambiguous — a transaction ID that has been used before — and a reused TrxID is how one payment would settle two
 * debts.
 */

/** The rider a token resolves to, or the refusal to answer with. */
async function riderFor(ctx: Ctx): Promise<RiderRow | Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  let userBytes: Uint8Array;
  try {
    userBytes = uuidBytes(principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  const rider = await findRiderByUserId(ctx.db, userBytes);
  if (rider === null) return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  return rider;
}

/** The settlement as the app reads it: identity, amount, status and when it arrived. */
function serialiseSettlement(row: SettlementRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    status: row.status,
    method: row.method,
    amountPaisa: row.amountPaisa,
    trxId: row.trxId,
    submittedAt: row.createdAt,
  };
}

/**
 * The rider's cash position: `GET /v1/rider/cash` (`08 §8`).
 *
 * Four facts and the settlement they are about: what is outstanding, whether the block is on, when the obligation began,
 * and the latest submission with its status. A rider who owes nothing is a `200` with zeroes rather than an error —
 * that is the ordinary end of a shift that collected no cash, and it is the state in which the app shows the summary
 * and nothing else.
 *
 * `dueAt` is not a future deadline: `25` sets none, because the block is immediate. It is the instant the obligation
 * began — the end of the shift that collected the cash — which is what lets the screen say "you have carried ৳2 140
 * since 22:14" (D140).
 */
async function cashPosition(ctx: Ctx): Promise<Response> {
  const rider = await riderFor(ctx);
  if (rider instanceof Response) return rider;

  const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
  const dueAtMs = await cashDueAtMs(ctx.db, rider.id);
  const latest = await latestSettlement(ctx.db, rider.id);
  return successResponse(
    {
      cashInHandPaisa: outstanding,
      dueAt: dueAtMs === null ? null : new Date(dueAtMs).toISOString(),
      locked: rider.shiftState === "CASH_LOCKED",
      settlementRequired: outstanding > 0,
      shiftState: rider.shiftState,
      settlement: latest === null ? null : serialiseSettlement(latest),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * Submit a settlement: `POST /v1/rider/cash/settle` (`25 §5`, D141).
 *
 * Six refusals, each a screen state rather than a validation message:
 *
 * - nothing owed is `CASH_ALREADY_SETTLED` — there is no debt to clear;
 * - a submission already under review is the same code, because two pending claims are two payments to a reviewer;
 * - a TrxID already in the table is `CASH_TRXID_DUPLICATE`, **unless** it is this rider's own claim arriving twice, in
 *   which case the answer is the first one: the app queues offline and retries, and idempotency is the difference
 *   between a retry and a second payment;
 * - more than is owed is `CASH_OVERPAYMENT`; less is `CASH_UNDERPAYMENT` with `short_by`, because `25 §7`'s partial path
 *   needs a reason and that path is not built.
 *
 * The two comparisons from `25 §6` are stored beside the claim so the reviewer sees what the platform saw, and the audit
 * row carries the same flags: a settlement decision made four minutes later must be explainable from the chain.
 */
async function settleCash(ctx: Ctx, body: unknown): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  // The body is judged before any row is read: a rider who mistyped their transaction ID should not cost two queries and
  // should not learn anything about their balance from the order in which the checks happen.
  const parsed = parseSettlement(body);
  if (!parsed.ok) return failureResponse({ code: parsed.code, details: parsed.details }, ctx.locale, ctx.requestId);
  const draft = parsed.draft;

  const rider = await riderFor(ctx);
  if (rider instanceof Response) return rider;

  const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
  const dueAtMs = await cashDueAtMs(ctx.db, rider.id);
  if (outstanding === 0) {
    const last = await latestSettlement(ctx.db, rider.id);
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: last === null ? new Date().toISOString() : last.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const duplicate = await settlementByTrx(ctx.db, draft.trxId);
  if (duplicate !== null) {
    // Idempotent retry: the same claim from the same rider is the same answer, and nothing new is written.
    if (duplicate.riderId === toHexId(rider.id)) {
      return successResponse({ settlement: serialiseSettlement(duplicate), duplicate: true }, ctx.locale, ctx.requestId);
    }
    return failureResponse({ code: "CASH_TRXID_DUPLICATE", details: { trx_id: draft.trxId } }, ctx.locale, ctx.requestId);
  }

  const pending = await pendingSettlement(ctx.db, rider.id);
  if (pending !== null) {
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: pending.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  if (draft.amountPaisa > outstanding)
    return failureResponse(
      { code: "CASH_OVERPAYMENT", details: { expected: outstanding, received: draft.amountPaisa } },
      ctx.locale,
      ctx.requestId,
    );
  if (draft.amountPaisa < outstanding)
    return failureResponse(
      {
        code: "CASH_UNDERPAYMENT",
        details: { expected: outstanding, received: draft.amountPaisa, short_by: outstanding - draft.amountPaisa },
      },
      ctx.locale,
      ctx.requestId,
    );

  const onFile = await payoutIdentity(ctx.db, rider.id);
  const checks = checkClaim(draft, onFile);
  const shiftId = await lastShiftId(ctx.db, rider.id);
  const nowMs = Date.now();
  const id = await writeSettlement(
    ctx.db,
    {
      riderId: rider.id,
      shiftId,
      amountPaisa: draft.amountPaisa,
      method: draft.method,
      trxId: draft.trxId,
      bkashNumber: draft.bkashNumber,
      accountName: draft.accountName,
      screenshotUrl: draft.screenshotUrl,
      selfieUrl: draft.selfieUrl,
      numberMatches: checks.numberMatches,
      nameMatches: checks.nameMatches,
    },
    nowMs,
  );

  await audit.appendAudit(
    ctx.db,
    {
      actorId: ctx.principal?.userId ?? null,
      actorType: "RIDER",
      actorRole: ctx.principal?.role ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "rider.cash.settle",
      resourceType: "RIDER_CASH_SETTLEMENT",
      resourceId: toHexId(id),
      subjectId: toHexId(rider.id),
      before: null,
      after: {
        amountPaisa: draft.amountPaisa,
        method: draft.method,
        trxId: draft.trxId,
        outstandingBefore: outstanding,
        numberMatches: checks.numberMatches,
        nameMatches: checks.nameMatches,
      },
      reason: "RIDER_SETTLED",
      severity: "NOTICE",
    },
    nowMs,
  );

  return successResponse(
    {
      settlement: {
        id: toHexId(id),
        status: "PENDING",
        method: draft.method,
        amountPaisa: draft.amountPaisa,
        trxId: draft.trxId,
        submittedAt: new Date(nowMs).toISOString(),
      },
      // What the reviewer will see, so the rider is not surprised later: a flag is not a refusal (see the module note).
      numberMatches: checks.numberMatches,
      nameMatches: checks.nameMatches,
      dueAt: dueAtMs === null ? null : new Date(dueAtMs).toISOString(),
      reviewDueBy: new Date(nowMs + REVIEW_SLA_MS).toISOString(),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * How long a review may take before the block is meant to lift (`25 §8`).
 *
 * Carried in the answer as `reviewDueBy` so the app can promise a bound rather than an apology. The auto-lift itself is
 * not built — nothing sweeps pending settlements — and until it is, this is a promise the platform makes and does not
 * keep. That is written down here rather than left for a rider to discover.
 */
export const REVIEW_SLA_MS = 2 * 60 * 60 * 1_000;

/** Where the settlement's `submittedAt` came from, for the tests that assert the two agree. */
export function submittedAtOf(row: SettlementRow): number | null {
  const parsed = parseDatetime(row.createdAt);
  return parsed === null ? null : parsed.getTime();
}

/** The rider's cash routes, in the order `08 §8` lists them. */
export const CASH_ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/rider/cash",
    permission: "rider.view_finance",
    group: "PRESENCE",
    run: async (ctx) => cashPosition(ctx),
  },
  {
    method: "POST",
    path: "/v1/rider/cash/settle",
    permission: "rider.view_finance",
    write: true,
    group: "PRESENCE",
    maxBodyBytes: 4_096,
    run: async (ctx, input) => settleCash(ctx, input.body),
  },
];

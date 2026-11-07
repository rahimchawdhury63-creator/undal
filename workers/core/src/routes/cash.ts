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
import {
  cashCollectedPaisa,
  cashDueAtMs,
  cashOutstandingPaisa,
  findRiderByUserId,
  type RiderRow,
} from "../repositories/riders.ts";
import {
  activeLiftUntil,
  cashLines,
  cashLinesTotal,
  lastDeclaration,
  lastShiftId,
  latestSettlement,
  payoutIdentity,
  pendingSettlement,
  writeDeclaration,
  settlementByTrx,
  writeSettlement,
  type SettlementRow,
} from "../repositories/cash.ts";
import {
  AUTO_LIFT_MS,
  autoLiftDue,
  checkClaim,
  EMERGENCY_LIFT_MS,
  isDeclarationKind,
  parseSettlement,
  repeatedEmergency,
} from "../domain/rider/cash.ts";

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

/** Whether the rider is actually blocked, and which of the two releases has already applied. */
export interface CashLift {
  readonly locked: boolean;
  /** `25 §8`'s two-hour rule: nobody reviewed the claim in time, so the platform lets the rider through (D142). */
  readonly autoLiftDue: boolean;
  /** A reviewer said "a human is looking into this" and released the rider while it is decided (D146). */
  readonly escalated: boolean;
  /** The rider declared an emergency and the platform lifted the block for a day (D148). */
  readonly declared: boolean;
}

/** When the pending claim arrived, in epoch ms, or `null` if there is nothing pending. */
export function submittedAtMs(row: SettlementRow | null): number | null {
  if (row === null || row.status !== "PENDING") return null;
  const parsed = parseDatetime(row.createdAt);
  return parsed === null ? null : parsed.getTime();
}

/**
 * The effective block, computed rather than stored.
 *
 * `riders.shift_state` says `CASH_LOCKED` and stays saying it until the rider next presents themselves at a door, which
 * is the whole point: there is no cron in this platform, so a deadline cannot fire anything. `25 §8`'s two-hour rule is
 * therefore a rule about *state* — "a rider whose claim has waited two hours is not blocked" — and this function is that
 * rule. The read reports it; `POST /v1/rider/shift/start` writes it, because a door that opens is the only moment the
 * lift needs to become a fact rather than a calculation.
 *
 * There are two ways out of the block and they are both computed here (D146): the platform was too slow, or a reviewer
 * escalated the claim and released the rider while it is decided. Neither forgives the debt — `outstanding_paisa` is
 * untouched by both — because the block is a collection mechanism and a rider's livelihood is on the other side of it.
 */
export function liftStateOf(
  shiftState: string,
  latest: SettlementRow | null,
  declaredUntilMs: number | null,
  nowMs: number,
): CashLift {
  if (shiftState !== "CASH_LOCKED") return { locked: false, autoLiftDue: false, escalated: false, declared: false };
  // `25 §7`'s fourth way out: the rider said they cannot settle tonight and the platform believed them for a day. The
  // window is computed here rather than written into `shift_state`, for the same reason as the other two — a timer that
  // has to fire is a timer this platform does not have.
  if (declaredUntilMs !== null && declaredUntilMs > nowMs) {
    return { locked: false, autoLiftDue: false, escalated: false, declared: true };
  }
  // An escalation is a human promising to look, so the rider stops waiting the moment it is made (D146). It is checked
  // before the clock because a promise made is better evidence than a promise that ran out — and because the audit trail
  // should say "escalated", not "the platform was slow", when a reviewer was already on it.
  if (latest !== null && latest.escalatedAt !== null) return { locked: false, autoLiftDue: false, escalated: true, declared: false };
  const overdue = autoLiftDue(submittedAtMs(latest), nowMs);
  return { locked: !overdue, autoLiftDue: overdue, escalated: false, declared: false };
}

/** The settlement as the app reads it: identity, amount, status and when it arrived. */
function serialiseSettlement(row: SettlementRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    status: row.status,
    method: row.method,
    amountPaisa: row.amountPaisa,
    // What the platform actually accepted, when that differs from the claim: `25 §6.1` promises the rider is told what
    // remains, and "confirmed" beside an unchanged balance is exactly the confusion that promise prevents (D147).
    approvedPaisa: row.approvedPaisa,
    partial: row.isPartial,
    trxId: row.trxId,
    submittedAt: row.createdAt,
    // A refusal the rider cannot read is indistinguishable from being ignored (D144): `25 §6.2` asks for the reason.
    rejectionReason: row.rejectionReason,
    rejectionNote: row.rejectionNote,
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
 *
 * `locked` is the **effective** block (D142): a claim that has waited past `25 §8`'s two hours means the rider is not
 * blocked, whatever the stored `shift_state` still says, and `autoLiftDue` tells the app why so it can explain itself.
 */
async function cashPosition(ctx: Ctx): Promise<Response> {
  const rider = await riderFor(ctx);
  if (rider instanceof Response) return rider;

  const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
  const dueAtMs = await cashDueAtMs(ctx.db, rider.id);
  const latest = await latestSettlement(ctx.db, rider.id);
  const declaredUntilMs = await activeLiftUntil(ctx.db, rider.id, Date.now());
  const lift = liftStateOf(rider.shiftState, latest, declaredUntilMs, Date.now());
  return successResponse(
    {
      cashInHandPaisa: outstanding,
      dueAt: dueAtMs === null ? null : new Date(dueAtMs).toISOString(),
      // The effective block, not the stored one: a read must never show a rider a wall the platform has already dropped.
      locked: lift.locked,
      autoLiftDue: lift.autoLiftDue,
      escalated: lift.escalated,
      declared: lift.declared,
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
 * - more than is owed is `CASH_OVERPAYMENT`; less is `CASH_UNDERPAYMENT` with `short_by` **unless the rider said it was a
 *   part-payment** (`partial: true`, D151), in which case the claim is recorded at what they paid and the remainder stays
 *   outstanding. The refusal is the default because the commonest cause of a short figure is a mistyped one, and a route
 *   that quietly accepts it forgives a thousand taka; the flag is the difference between a typo and a choice.
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
  if (draft.amountPaisa < outstanding && !draft.partial)
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
      partial: draft.partial,
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
        // A part-payment leaves a remainder on purpose (`25 §7`), and the chain should say so rather than leaving a
        // reader to infer it from two numbers eleven characters apart.
        partial: draft.partial,
        remainingPaisa: outstanding - draft.amountPaisa,
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
        partial: draft.partial,
      },
      // What the reviewer will see, so the rider is not surprised later: a flag is not a refusal (see the module note).
      numberMatches: checks.numberMatches,
      nameMatches: checks.nameMatches,
      dueAt: dueAtMs === null ? null : new Date(dueAtMs).toISOString(),
      reviewDueBy: new Date(nowMs + AUTO_LIFT_MS).toISOString(),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * Where the number came from: `GET /v1/rider/cash/breakdown` (`25 §8`, D150).
 *
 * `25 §8` names the situation this route answers: *"A bug produces a wrong `cash_in_hand` — the 'I disagree' path exists
 * precisely for this, and the order-by-order list makes the error visible to both sides."* A rider told they are carrying
 * ৳2 140 and shown eight deliveries that add up to it will pay it; a rider told the same number with no explanation is
 * being asked to take the platform's word for a debt. This is the eight rows.
 *
 * The arithmetic is reported rather than reconciled: `collectedPaisa` comes from the balance, `linesPaisa` from the
 * deliveries, and `differencePaisa` is what is left over. A non-zero difference is the bug `§8` describes, and surfacing
 * it to the rider is deliberate — the alternative is a screen that hides a disagreement it already knows about, which is
 * how a support call becomes an accusation.
 *
 * `deliveredAt` is the assignment's end, not the order's `delivered_at`: the same fact the attribution uses, so a line
 * cannot say "delivered at 22:14" about a delivery the rider did not make.
 */
async function cashBreakdown(ctx: Ctx): Promise<Response> {
  const rider = await riderFor(ctx);
  if (rider instanceof Response) return rider;

  const requested = Number(ctx.url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 50;
  const lines = await cashLines(ctx.db, rider.id, limit);
  const total = await cashLinesTotal(ctx.db, rider.id);
  const collected = await cashCollectedPaisa(ctx.db, rider.id);
  return successResponse(
    {
      deliveries: lines,
      // The page is capped, so the total is its own query: a rider with four hundred deliveries still gets the figure.
      linesPaisa: total,
      collectedPaisa: collected,
      differencePaisa: collected - total,
      truncated: lines.length === limit,
      outstandingPaisa: await cashOutstandingPaisa(ctx.db, rider.id),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * Declare why the rider cannot settle: `POST /v1/rider/cash/declare` (`25 §7`, D148).
 *
 * The section opens with a screen and four buttons, and closes with the rule they exist for: *"The block exists to
 * collect money from people who have it and are about to go home — not to punish people who do not."* Three of the four
 * are built here: **I have an emergency** (D148), **I was robbed or lost the money** (D149) and **I disagree with this
 * amount** (D153). The fourth — "I'll settle part of it now" — is not a declaration at all: it is a settlement for less
 * than the balance, `POST /v1/rider/cash/settle` with `partial: true` (D151).
 *
 * The two differ in exactly one field, and it is the field that matters. An emergency is a window — 24 hours, then the
 * block returns, because the money is still owed and the rider expects to have it. A robbery is a *case* — the lift has
 * no expiry and always routes to a human, because `§7` says the debt is "handled case by case" and a case that a timer
 * can close at midnight is not a case. A robbery also requires a sentence: somebody will ring this rider back, and
 * "robbed" alone tells them nothing about when, where, or which police station was told.
 *
 * **It lifts the block for 24 hours, and the lift is computed.** No state write here — `activeLiftUntil` answers the
 * same question from the declaration's `lifted_until`, and `liftStateOf` treats a live window like an escalation. The
 * rider's next request opens the door and writes `OFFLINE`; the read stops showing a wall immediately. One rule about the
 * block, three ways out of it (`§8`'s two-hour rule, `§6.1`'s escalation, this).
 *
 * **The second use in thirty days still lifts, and also wakes somebody.** `§7` says it "routes to a human instead of
 * being refused", which is a promise about the lift as much as about the routing: every path in that section lifts the
 * block. So the declaration is written either way, `routed_to_review` marks the second, and the audit row goes from
 * `NOTICE` to `WARNING` so the morning's reviewer list has it at the top.
 *
 * **A dispute freezes the arithmetic it disputes.** The delivery list a rider argues with is live, so a reviewer
 * opening the dispute a day later would be reading yesterday's objection against today's numbers. The declaration
 * therefore stores the breakdown's totals as they stood (`025`), and the response hands the rider the same figure the
 * reviewer will see.
 */
async function declareCash(ctx: Ctx, body: unknown): Promise<Response> {
  const rider = await riderFor(ctx);
  if (rider instanceof Response) return rider;

  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const kind = fields["kind"];
  if (!isDeclarationKind(kind)) {
    return failureResponse(
      { code: "VALIDATION_ENUM", details: { field: "kind", allowed: ["EMERGENCY", "ROBBED", "DISPUTE"] } },
      ctx.locale,
      ctx.requestId,
    );
  }



  const noteRaw = fields["note"] ?? null;
  if (noteRaw !== null && (typeof noteRaw !== "string" || noteRaw.trim().length > 280)) {
    return failureResponse({ code: "VALIDATION_REQUIRED", details: { fields: ["note"] } }, ctx.locale, ctx.requestId);
  }
  const note = noteRaw === null ? null : (noteRaw as string).trim();
  if (kind !== "EMERGENCY" && (note === null || note.length === 0)) {
    // A theft or a dispute with no words is not a claim. For a robbery somebody has to ring this rider back, and
    // "robbed" alone says nothing about when or where (D149); for a dispute the sentence is the disagreement, and a
    // reviewer cannot answer "I disagree" with nothing beside it (D153).
    return failureResponse({ code: "VALIDATION_REQUIRED", details: { fields: ["note"] } }, ctx.locale, ctx.requestId);
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
  if (outstanding === 0) {
    // Nothing is owed, so there is nothing to be unable to settle. This is a 409 rather than a 422 because the rider's
    // state is the reason, and the app's answer is "you're clear", not "check your input".
    return failureResponse({ code: "CASH_ALREADY_SETTLED", details: { settled_at: new Date().toISOString() } }, ctx.locale, ctx.requestId);
  }

  const nowMs = Date.now();
  const previous = await lastDeclaration(ctx.db, rider.id, "EMERGENCY");
  const previousMs = previous === null ? null : parseDatetime(previous.createdAt)?.getTime() ?? null;
  // Only an emergency has a cooldown and a window. A robbery lifts the block with **no expiry** (`lifted_until` null) and
  // always routes to a human: `§7` says the amount is "handled case by case", and a case by case decision cannot be a
  // timer that puts somebody back behind the block at midnight (D149).
  const robbed = kind === "ROBBED";
  const disputed = kind === "DISPUTE";
  // Both a robbery and a dispute are cases: no expiry, and always routed. The difference is what the reviewer reads —
  // "I was robbed" is a story and "your arithmetic is wrong" is a number, so a dispute also freezes the arithmetic the
  // rider was looking at (D153), because by the time a human opens it the delivery list has moved on.
  const caseOpened = robbed || disputed;
  const repeated = caseOpened || repeatedEmergency(previousMs, nowMs);
  const liftedUntilMs = caseOpened ? null : nowMs + EMERGENCY_LIFT_MS;

  let disputedArithmetic: { linesPaisa: number; differencePaisa: number } | null = null;
  if (disputed) {
    const linesPaisa = await cashLinesTotal(ctx.db, rider.id);
    disputedArithmetic = { linesPaisa, differencePaisa: outstanding - linesPaisa };
  }
  const id = await writeDeclaration(
    ctx.db,
    {
      riderId: rider.id,
      kind,
      note,
      liftedUntilMs,
      routedToReview: repeated,
      snapshotLinesPaisa: disputedArithmetic === null ? null : disputedArithmetic.linesPaisa,
      snapshotDifferencePaisa: disputedArithmetic === null ? null : disputedArithmetic.differencePaisa,
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
      action: "rider.cash.declare",
      resourceType: "RIDER_CASH_DECLARATION",
      resourceId: toHexId(id),
      subjectId: toHexId(rider.id),
      before: { shiftState: rider.shiftState, outstandingPaisa: outstanding },
      after: {
        kind,
        note,
        liftedUntil: liftedUntilMs === null ? null : new Date(liftedUntilMs).toISOString(),
        routedToReview: repeated,
        // What the platform claimed at the moment it was disputed, so the chain and the reviewer agree about the figure.
        ...(disputedArithmetic === null
          ? {}
          : { linesPaisa: disputedArithmetic.linesPaisa, differencePaisa: disputedArithmetic.differencePaisa }),
      },
      // A rider's own declaration is not an admin reason, and the register is a list of admin reasons. The `after` block
      // carries everything a reviewer needs, and putting a word from that list here would attribute it to the rider.
      reason: null,
      severity: robbed ? "CRITICAL" : repeated ? "WARNING" : "NOTICE",
    },
    nowMs,
  );

  return successResponse(
    {
      declaration: {
        id: toHexId(id),
        kind,
        note,
        // `null` is a promise with no end, not a missing value: a robbed rider is not put back behind the block by a timer.
        liftedUntil: liftedUntilMs === null ? null : new Date(liftedUntilMs).toISOString(),
        routedToReview: repeated,
      },
      // The arithmetic as it stood when the rider objected: `differencePaisa` non-zero is the bug they are reporting.
      disputed: disputedArithmetic,
      released: true,
      outstandingPaisa: outstanding,
      // Said explicitly: the debt is untouched. `§7` lifts the block; it does not forgive the money.
      stillOwedPaisa: outstanding,
    },
    ctx.locale,
    ctx.requestId,
  );
}

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
  {
    method: "POST",
    path: "/v1/rider/cash/declare",
    permission: "rider.view_finance",
    write: true,
    group: "PRESENCE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => declareCash(ctx, input.body),
  },
  {
    method: "GET",
    path: "/v1/rider/cash/breakdown",
    permission: "rider.view_finance",
    group: "PRESENCE",
    run: async (ctx) => cashBreakdown(ctx),
  },
];

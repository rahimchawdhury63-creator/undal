/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { reasonAllowed, reasonsFor } from "../audit/reasons.ts";
import { auditReasonFor, isRejectionReason, REJECTION_REASONS, refusalNeedsNote } from "../domain/rider/cash.ts";
import { toHexId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { cashOutstandingPaisa, setShiftState, shiftStateOf } from "../repositories/riders.ts";
import type { RejectionReason } from "../domain/rider/cash.ts";
import {
  claimSettlement,
  creditDeposit,
  escalateSettlement,
  rejectSettlement,
  releaseClaim,
  settlementById,
} from "../repositories/cash.ts";
import { PLATFORM_ACCOUNTS, riderCashAccount } from "../domain/ledger/accounts.ts";
import { postEntry } from "../domain/ledger/post-entry.ts";

/**
 * The reviewer's side of a cash settlement: one route, and the reason it is the last piece of `25` that was missing
 * (D143).
 *
 * `POST /v1/rider/cash/settle` leaves a `PENDING` row for a human, and until now there was no route a human could use:
 * a claim was auto-lifted after two hours (D142) or it waited forever. That made `25 §6`'s review a promise with a
 * screenshot attached and no reviewer behind it.
 *
 * **Approval is the only thing that takes money off the books, and it does so in the ledger.** The rider holding ৳2 140
 * of the platform's cash is an asset (`RIDER_CASH:{id}`); handing it over moves it to the bank, so the entry is
 * `RIDER_CASH −amount` and `PLATFORM:BANK +amount`, exactly as `24 §6` writes it. This route is the first live path to
 * call `postEntry`, which means the ledger's closure check now runs on a request rather than only in tests.
 *
 * **The status transition is the lock.** `UPDATE ... WHERE status = 'PENDING'` returns one affected row to exactly one
 * caller, so two reviewers who open the same claim a minute apart cannot both post an entry. The loser is told the
 * settlement is already settled — a message about the row, not about their typing.
 *
 * **Three statements, no transaction, so the route unwinds by hand.** TiDB auto-commits each statement and the HTTP
 * driver's interactive transactions are not concurrency-safe, so approval cannot be atomic. The order is chosen for what
 * a failure leaves behind: the claim is taken first (so a retry cannot double-post), then the deposit is credited, then
 * the ledger entry is posted. If the ledger fails, the deposit is credited back and the claim released, and the reviewer
 * gets `500` and a settlement that is still pending — which is the only failure shape a reviewer can safely retry.
 *
 * **A rejection is the cheaper decision and the one that has to explain itself.** No money moves, no balance changes, no
 * ledger entry: one `UPDATE ... WHERE status = 'PENDING'` and one audit row. What it must carry is a reason, because
 * `25 §6.2` requires one from a controlled list and requires the rider to *see* it — and the rider cannot read the audit
 * log. The reason is therefore stored on the settlement itself (migration `020`), checked against `§6.2`'s nine codes,
 * and returned by `GET /v1/rider/cash` under the rejected row. A refusal the rider cannot read is indistinguishable from
 * the platform ignoring them.
 *
 * Two vocabularies meet here and neither is bent to fit the other. The settlement carries the *rider's* word — one of the
 * nine `§6.2` codes, because that string is what the blocking screen translates and pairs with a correction path — and
 * the audit row carries the nearest *register* code (`CASH_COUNTED_SHORT` or `SETTLEMENT_DISPUTED`), because the audit
 * register is a closed list shared with every other action and cannot grow a settlement-shaped corner.
 *
 * **A partial approval is an approval with a number, and it must say why (D147).** `25 §6.1`'s second decision is
 * "approve a different amount": the reviewer accepts less than the rider claimed, the difference stays `RIDER_CASH`, and
 * the rider is told what remains. The amount is validated against the claim rather than against the balance — an
 * approval larger than the claim would credit money the rider never claimed — and a partial acceptance **requires** a
 * reason, because a number that disagrees with the rider's own figure is the one approval a rider will question. The
 * stored `approved_paisa` is what the ledger entry and the deposit credit are built from, so the books and the claim
 * cannot disagree about how much moved.
 *
 * **A clean approval has no reason code, and that is not an oversight.** The register in `audit/reasons.ts` holds six
 * operational reasons plus `CASH_NOT_HANDED_OVER` and `CASH_COUNTED_SHORT` for this permission key — all of them describe
 * something *anomalous*. A reviewer confirming that the money arrived as claimed has nothing to name, so `reason` is
 * optional and `null` is the honest record; when one is supplied it is checked against the register, which is how a
 * reviewer flags "counted short" while still approving (`25 §7`'s partial path, which is not otherwise built).
 */

/** What a reviewer may send with an approval: an amount, a register reason, and a sentence for the audit row. */
interface Decision {
  /** What was accepted, in paisa, or `null` for "the whole claim". Validated against the claim in `approveSettlement`. */
  readonly amountPaisa: number | null;
  readonly reason: string | null;
  readonly note: string | null;
}

/** Parse the optional body without ever refusing a reviewer for sending nothing. */
function parseDecision(
  body: unknown,
): Decision | { readonly code: "VALIDATION_REQUIRED"; readonly details: Record<string, unknown> } {
  if (body === null || body === undefined) return { amountPaisa: null, reason: null, note: null };
  if (typeof body !== "object" || Array.isArray(body)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["reason", "note"] } };
  }
  const raw = body as Record<string, unknown>;
  const reason = raw["reason"] ?? null;
  const note = raw["note"] ?? null;
  const amount = raw["amountPaisa"] ?? null;
  if (amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["amountPaisa"] } };
  }
  if (reason !== null && (typeof reason !== "string" || reason.trim().length === 0)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["reason"] } };
  }
  if (note !== null && (typeof note !== "string" || note.trim().length > 280)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["note"] } };
  }
  if (reason !== null && !reasonAllowed(reason as string, "finance.cash.approve_settlement")) {
    return {
      code: "VALIDATION_REQUIRED",
      details: { fields: ["reason"], allowed: reasonsFor("finance.cash.approve_settlement").map((entry) => entry.code) },
    };
  }
  return {
    amountPaisa: amount === null ? null : (amount as number),
    reason: reason === null ? null : (reason as string),
    note: note === null ? null : (note as string).trim(),
  };
}

/** A parsed id, or the refusal for one that is not a UUID. */
function idBytes(raw: string): Uint8Array | null {
  try {
    return uuidBytes(raw);
  } catch {
    return null;
  }
}

/**
 * Approve a settlement: `POST /v1/finance/cash/settlements/{id}/approve` (D143).
 *
 * Six outcomes, and each is a state a reviewer can act on: `404` for an id that names nothing (`MONEY_PAYOUT_NOT_FOUND`,
 * the nearest code the pinned registry has for a settlement — `25 §11` records the noun mismatch rather than inventing
 * one); `409 CASH_ALREADY_SETTLED` for a claim somebody else decided, or decided twice; `422` for a malformed id or a
 * reason outside the register; `500` for a platform failure that unwound itself; `200` for the approval.
 */
async function approveSettlement(ctx: Ctx, rawId: string, body: unknown): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const id = idBytes(rawId);
  if (id === null) return failureResponse({ code: "VALIDATION_ID_MALFORMED", details: { field: "id" } }, ctx.locale, ctx.requestId);

  const decision = parseDecision(body);
  if ("code" in decision) return failureResponse({ code: decision.code, details: decision.details }, ctx.locale, ctx.requestId);

  const row = await settlementById(ctx.db, id);
  if (row === null) {
    return failureResponse({ code: "MONEY_PAYOUT_NOT_FOUND", details: { payout_id: rawId } }, ctx.locale, ctx.requestId);
  }
  if (row.status !== "PENDING") {
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: row.confirmedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const accepted = decision.amountPaisa ?? row.amountPaisa;
  const partial = accepted !== row.amountPaisa;
  if (accepted > row.amountPaisa) {
    // More than the claim: the rider claimed a figure and the platform cannot accept more than was claimed for it.
    return failureResponse(
      { code: "MONEY_REFUND_EXCEEDS_PAID", details: { paid: row.amountPaisa, requested: accepted } },
      ctx.locale,
      ctx.requestId,
    );
  }
  if (accepted === 0) {
    // Accepting nothing is a rejection wearing an approval's clothes, and it would release nobody while closing the claim.
    return failureResponse({ code: "VALIDATION_REQUIRED", details: { fields: ["amountPaisa"] } }, ctx.locale, ctx.requestId);
  }
  if (partial && decision.reason === null) {
    // A number that disagrees with the rider's own figure is the one approval they will question, so it must be explained.
    return failureResponse(
      {
        code: "VALIDATION_REQUIRED",
        details: {
          fields: ["reason"],
          allowed: reasonsFor("finance.cash.approve_settlement").map((entry) => entry.code),
        },
      },
      ctx.locale,
      ctx.requestId,
    );
  }

  const nowMs = Date.now();
  const riderBytes = uuidBytes(row.riderId);
  let adminBytes: Uint8Array;
  try {
    adminBytes = uuidBytes(ctx.principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_an_admin" } }, ctx.locale, ctx.requestId);
  }

  if (!(await claimSettlement(ctx.db, id, adminBytes, accepted, nowMs))) {
    // Two reviewers, one claim: the other one won between the read above and this write.
    const latest = await settlementById(ctx.db, id);
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: latest?.confirmedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  if (!(await creditDeposit(ctx.db, riderBytes, accepted, nowMs))) {
    await releaseClaim(ctx.db, id);
    return failureResponse({ code: "INTERNAL", details: { trace_id: ctx.requestId } }, ctx.locale, ctx.requestId);
  }

  let entryId: string;
  try {
    const posted = await postEntry(ctx.db, {
      entryType: "CASH_SETTLED",
      description: `Cash settlement ${toHexId(id)}: ${accepted} paisa handed over`,
      postings: [
        { account: riderCashAccount(row.riderId), amountPaisa: -accepted },
        { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: accepted },
      ],
      settlementId: toHexId(id),
      createdBy: ctx.principal.userId,
      nowMs,
    });
    entryId = posted.entryId;
  } catch {
    // The books could not be written, so nothing happened: give the deposit back and let the claim be retried.
    await creditDeposit(ctx.db, riderBytes, -accepted, nowMs);
    await releaseClaim(ctx.db, id);
    return failureResponse({ code: "INTERNAL", details: { trace_id: ctx.requestId } }, ctx.locale, ctx.requestId);
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, riderBytes);
  const before = await shiftStateOf(ctx.db, riderBytes);
  // Two ways to have settled: the balance is clear, or the rider paid what they could and said so (`25 §7`, D151).
  // `§7` promises the second one may go online "with a reduced cash limit equal to their remaining headroom", and the
  // dispatch ceiling of ৳3 500 is what enforces the reduction, so lifting the block is the whole of the promise this
  // route can keep. The remainder stays on the books and the weekly invoice gate collects it (`24 §6`).
  const released = (outstanding === 0 || row.isPartial) && before === "CASH_LOCKED";
  if (released) await setShiftState(ctx.db, riderBytes, "OFFLINE");

  await audit.appendAudit(
    ctx.db,
    {
      actorId: ctx.principal.userId,
      actorType: "ADMIN",
      actorRole: ctx.principal.role ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "finance.cash.approve_settlement",
      resourceType: "RIDER_CASH_SETTLEMENT",
      resourceId: toHexId(id),
      subjectId: row.riderId,
      before: { status: "PENDING", shiftState: before, outstandingPaisa: outstanding + accepted },
      after: {
        status: "CONFIRMED",
        shiftState: released ? "OFFLINE" : before,
        outstandingPaisa: outstanding,
        claimedPaisa: row.amountPaisa,
        approvedPaisa: accepted,
        partial: row.isPartial,
        ledgerEntryId: entryId,
        note: decision.note,
      },
      reason: decision.reason,
      severity: "NOTICE",
    },
    nowMs,
  );

  return successResponse(
    {
      settlement: {
        id: toHexId(id),
        status: "CONFIRMED",
        method: row.method,
        amountPaisa: row.amountPaisa,
        // Both numbers, so the reviewer and the rider's screen can say "৳1 000 of ৳2 140 accepted, ৳1 140 still owed".
        approvedPaisa: accepted,
        partial: row.isPartial,
        trxId: row.trxId,
        submittedAt: row.createdAt,
        confirmedAt: new Date(nowMs).toISOString(),
      },
      ledgerEntryId: entryId,
      outstandingPaisa: outstanding,
      // Whether this approval removed the block, so the reviewer sees the consequence and the app can explain it.
      released,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** A rejection's body: one of `25 §6.2`'s nine codes, and the reviewer's sentence when the code needs it. */
interface Refusal {
  readonly reason: RejectionReason;
  readonly note: string | null;
}

/**
 * Parse a rejection's body, which is not optional in the way an approval's is.
 *
 * Three refusals of the refusal: no `reason` at all (the rider would get a wall with no explanation), a code that is not
 * one of `§6.2`'s nine (the rider's screen has no translation and no instruction for it), and `OTHER` without a note (the
 * reviewer picked the escape hatch and left the other side of it blank). A note longer than 280 characters is refused
 * rather than truncated, because a silently shortened explanation is worse than a visible one.
 */
function parseRefusal(body: unknown): Refusal | { readonly code: "VALIDATION_REQUIRED"; readonly details: Record<string, unknown> } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["reason"], allowed: [...REJECTION_REASONS] } };
  }
  const raw = body as Record<string, unknown>;
  const reason = raw["reason"];
  const note = raw["note"] ?? null;
  if (!isRejectionReason(reason)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["reason"], allowed: [...REJECTION_REASONS] } };
  }
  if (note !== null && (typeof note !== "string" || note.trim().length > 280)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["note"] } };
  }
  const trimmed = note === null ? null : (note as string).trim();
  if (refusalNeedsNote(reason) && (trimmed === null || trimmed.length === 0)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["note"] } };
  }
  return { reason, note: trimmed };
}

/**
 * Reject a settlement: `POST /v1/finance/cash/settlements/{id}/reject` (D144).
 *
 * The mirror of approval with three deliberate asymmetries. It moves no money, so there is nothing to unwind and no
 * ledger entry; it *requires* a reason, because `25 §6.2` makes the reason the rider's correction path and a refusal
 * without one is a dead end; and it does not need a step-up code, because refusing a claim is not the act of releasing
 * somebody against cash the platform has not seen. The rider stays `CASH_LOCKED` — the block is the platform's only
 * collection mechanism and a rejection is the platform saying "not this evidence", not "never mind".
 */
async function refuseSettlement(ctx: Ctx, rawId: string, body: unknown): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const id = idBytes(rawId);
  if (id === null) {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", details: { field: "id" } }, ctx.locale, ctx.requestId);
  }

  const refusal = parseRefusal(body);
  if ("code" in refusal) {
    return failureResponse({ code: refusal.code, details: refusal.details }, ctx.locale, ctx.requestId);
  }

  const row = await settlementById(ctx.db, id);
  if (row === null) {
    return failureResponse({ code: "MONEY_PAYOUT_NOT_FOUND", details: { payout_id: rawId } }, ctx.locale, ctx.requestId);
  }
  if (row.status !== "PENDING") {
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: row.confirmedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const nowMs = Date.now();
  let adminBytes: Uint8Array;
  try {
    adminBytes = uuidBytes(ctx.principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_an_admin" } }, ctx.locale, ctx.requestId);
  }

  if (!(await rejectSettlement(ctx.db, id, adminBytes, refusal.reason, refusal.note, nowMs))) {
    const latest = await settlementById(ctx.db, id);
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: latest?.confirmedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, uuidBytes(row.riderId));
  await audit.appendAudit(
    ctx.db,
    {
      actorId: ctx.principal.userId,
      actorType: "ADMIN",
      actorRole: ctx.principal.role ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "finance.cash.reject_settlement",
      resourceType: "RIDER_CASH_SETTLEMENT",
      resourceId: toHexId(id),
      subjectId: row.riderId,
      before: { status: "PENDING", amountPaisa: row.amountPaisa, trxId: row.trxId, outstandingPaisa: outstanding },
      after: { status: "REJECTED", rejectionReason: refusal.reason, note: refusal.note, outstandingPaisa: outstanding },
      // The register's word, not the rider's: the audit register is shared with every other action (see the module note).
      reason: auditReasonFor(refusal.reason),
      severity: "WARNING",
    },
    nowMs,
  );

  return successResponse(
    {
      settlement: {
        id: toHexId(id),
        status: "REJECTED",
        method: row.method,
        amountPaisa: row.amountPaisa,
        trxId: row.trxId,
        submittedAt: row.createdAt,
        rejectedAt: new Date(nowMs).toISOString(),
        rejectionReason: refusal.reason,
        rejectionNote: refusal.note,
      },
      outstandingPaisa: outstanding,
      // Stated rather than implied: a rejection does not open the door, and the reviewer should see that it did not.
      released: false,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * Escalate a claim: `POST /v1/finance/cash/settlements/{id}/escalate` (`25 §6.1`, D146).
 *
 * The fourth decision, and the only one that costs the platform something without settling anything. A reviewer who
 * cannot tell from the evidence whether the money arrived — a bKash delay, a screenshot that will not open, a name that
 * changed last month — has three bad options and one good one: approve a payment they are not sure of, refuse a rider who
 * may be right, or make the rider wait. Escalation is the fourth: a human promises to look, and **the rider stops
 * waiting immediately**, because `§6.1` is explicit that an escalation is the platform's problem and not the rider's.
 *
 * **The debt is not forgiven.** No ledger entry, no deposit credit: `outstanding_paisa` is unchanged, the claim stays
 * `PENDING`, and the queue still lists it — with the escalation marked and the note attached, so the next reviewer picks
 * up where this one stopped rather than starting again. Releasing a rider and forgiving a debt are different acts and
 * this route only does the first.
 *
 * **It needs the approver's key, and that is the honest requirement.** There is no `finance.cash.escalate_settlement`
 * in the register, and inventing a permission so that a *less* accountable action can skip the step-up code would be the
 * wrong direction: an escalation releases a rider against cash the platform has not seen, which is the consequence the
 * step-up guards in the first place. So it borrows `finance.cash.approve_settlement` and inherits its TOTP requirement.
 */
async function escalateClaim(ctx: Ctx, rawId: string, body: unknown): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const id = idBytes(rawId);
  if (id === null) {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", details: { field: "id" } }, ctx.locale, ctx.requestId);
  }

  const noteRaw = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["note"] ?? null : null;
  if (noteRaw !== null && (typeof noteRaw !== "string" || noteRaw.trim().length > 280)) {
    return failureResponse({ code: "VALIDATION_REQUIRED", details: { fields: ["note"] } }, ctx.locale, ctx.requestId);
  }
  const note = noteRaw === null ? null : (noteRaw as string).trim();

  const row = await settlementById(ctx.db, id);
  if (row === null) {
    return failureResponse({ code: "MONEY_PAYOUT_NOT_FOUND", details: { payout_id: rawId } }, ctx.locale, ctx.requestId);
  }
  if (row.status !== "PENDING" || row.escalatedAt !== null) {
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: row.confirmedAt ?? row.escalatedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const nowMs = Date.now();
  let adminBytes: Uint8Array;
  try {
    adminBytes = uuidBytes(ctx.principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_an_admin" } }, ctx.locale, ctx.requestId);
  }

  if (!(await escalateSettlement(ctx.db, id, adminBytes, note, nowMs))) {
    const latest = await settlementById(ctx.db, id);
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: latest?.confirmedAt ?? latest?.escalatedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, uuidBytes(row.riderId));
  await audit.appendAudit(
    ctx.db,
    {
      actorId: ctx.principal.userId,
      actorType: "ADMIN",
      actorRole: ctx.principal.role ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "finance.cash.escalate_settlement",
      resourceType: "RIDER_CASH_SETTLEMENT",
      resourceId: toHexId(id),
      subjectId: row.riderId,
      before: { status: "PENDING", escalated: false, outstandingPaisa: outstanding },
      after: { status: "PENDING", escalated: true, note, outstandingPaisa: outstanding },
      // The register has no escalation code; `SETTLEMENT_DISPUTED` is the honest one — a human is looking because the
      // evidence and the claim do not agree, which is exactly what the word means.
      reason: "SETTLEMENT_DISPUTED",
      severity: "WARNING",
    },
    nowMs,
  );

  return successResponse(
    {
      settlement: {
        id: toHexId(id),
        status: "PENDING",
        method: row.method,
        amountPaisa: row.amountPaisa,
        trxId: row.trxId,
        submittedAt: row.createdAt,
        escalatedAt: new Date(nowMs).toISOString(),
        escalationNote: note,
      },
      outstandingPaisa: outstanding,
      // The consequence, stated rather than implied: the rider may start a shift from their next request onward.
      released: true,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The finance decisions (`08 §8`, D143–D146): three answers to one pending claim. */
export const CASH_REVIEW_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/finance/cash/settlements/{id}/approve",
    permission: "finance.cash.approve_settlement",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => approveSettlement(ctx, input.params["id"] ?? "", input.body),
  },
  {
    method: "POST",
    path: "/v1/finance/cash/settlements/{id}/reject",
    permission: "finance.cash.reject_settlement",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => refuseSettlement(ctx, input.params["id"] ?? "", input.body),
  },
  {
    method: "POST",
    path: "/v1/finance/cash/settlements/{id}/escalate",
    // Not a key of its own: escalation releases a rider against cash the platform has not seen, so it carries the
    // approver's permission — and therefore the approver's step-up code. See the handler.
    permission: "finance.cash.approve_settlement",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => escalateClaim(ctx, input.params["id"] ?? "", input.body),
  },
];

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { reasonAllowed, reasonsFor } from "../audit/reasons.ts";
import { toHexId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { cashOutstandingPaisa, setShiftState, shiftStateOf } from "../repositories/riders.ts";
import { claimSettlement, creditDeposit, releaseClaim, settlementById } from "../repositories/cash.ts";
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
 * **A clean approval has no reason code, and that is not an oversight.** The register in `audit/reasons.ts` holds six
 * operational reasons plus `CASH_NOT_HANDED_OVER` and `CASH_COUNTED_SHORT` for this permission key — all of them describe
 * something *anomalous*. A reviewer confirming that the money arrived as claimed has nothing to name, so `reason` is
 * optional and `null` is the honest record; when one is supplied it is checked against the register, which is how a
 * reviewer flags "counted short" while still approving (`25 §7`'s partial path, which is not otherwise built).
 */

/** What a reviewer may send with an approval: a register reason, and a sentence for the audit row. */
interface Decision {
  readonly reason: string | null;
  readonly note: string | null;
}

/** Parse the optional body without ever refusing a reviewer for sending nothing. */
function parseDecision(
  body: unknown,
): Decision | { readonly code: "VALIDATION_REQUIRED"; readonly details: Record<string, unknown> } {
  if (body === null || body === undefined) return { reason: null, note: null };
  if (typeof body !== "object" || Array.isArray(body)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["reason", "note"] } };
  }
  const raw = body as Record<string, unknown>;
  const reason = raw["reason"] ?? null;
  const note = raw["note"] ?? null;
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
  return { reason: reason === null ? null : (reason as string), note: note === null ? null : (note as string).trim() };
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

  const nowMs = Date.now();
  const riderBytes = uuidBytes(row.riderId);
  let adminBytes: Uint8Array;
  try {
    adminBytes = uuidBytes(ctx.principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_an_admin" } }, ctx.locale, ctx.requestId);
  }

  if (!(await claimSettlement(ctx.db, id, adminBytes, nowMs))) {
    // Two reviewers, one claim: the other one won between the read above and this write.
    const latest = await settlementById(ctx.db, id);
    return failureResponse(
      { code: "CASH_ALREADY_SETTLED", details: { settled_at: latest?.confirmedAt ?? row.createdAt } },
      ctx.locale,
      ctx.requestId,
    );
  }

  if (!(await creditDeposit(ctx.db, riderBytes, row.amountPaisa, nowMs))) {
    await releaseClaim(ctx.db, id);
    return failureResponse({ code: "INTERNAL", details: { trace_id: ctx.requestId } }, ctx.locale, ctx.requestId);
  }

  let entryId: string;
  try {
    const posted = await postEntry(ctx.db, {
      entryType: "CASH_SETTLED",
      description: `Cash settlement ${toHexId(id)}: ${row.amountPaisa} paisa handed over`,
      postings: [
        { account: riderCashAccount(row.riderId), amountPaisa: -row.amountPaisa },
        { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: row.amountPaisa },
      ],
      settlementId: toHexId(id),
      createdBy: ctx.principal.userId,
      nowMs,
    });
    entryId = posted.entryId;
  } catch {
    // The books could not be written, so nothing happened: give the deposit back and let the claim be retried.
    await creditDeposit(ctx.db, riderBytes, -row.amountPaisa, nowMs);
    await releaseClaim(ctx.db, id);
    return failureResponse({ code: "INTERNAL", details: { trace_id: ctx.requestId } }, ctx.locale, ctx.requestId);
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, riderBytes);
  const before = await shiftStateOf(ctx.db, riderBytes);
  const released = outstanding === 0 && before === "CASH_LOCKED";
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
      before: { status: "PENDING", shiftState: before, outstandingPaisa: outstanding + row.amountPaisa },
      after: {
        status: "CONFIRMED",
        shiftState: released ? "OFFLINE" : before,
        outstandingPaisa: outstanding,
        amountPaisa: row.amountPaisa,
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

/** The finance routes (`08 §8`, D143): one decision, one settlement. */
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
];

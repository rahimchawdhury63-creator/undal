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
import { cashCollectedPaisa, cashOutstandingPaisa, setShiftState, shiftStateOf } from "../repositories/riders.ts";
import { writeOffBalance } from "../repositories/cash.ts";
import { declarationById, resolveDeclaration } from "../repositories/declarations.ts";
import { PLATFORM_ACCOUNTS, riderCashAccount } from "../domain/ledger/accounts.ts";
import { postEntry } from "../domain/ledger/post-entry.ts";

/**
 * Writing off money the platform was wrong to expect (`25 §7`, D155).
 *
 * The cash story now has every decision except the one that admits a mistake: a reviewer can approve (D143), refuse
 * (D144), escalate (D146), and read the cases `§7` opens (D154) — and a dispute resolved in the rider's favour had
 * nowhere to go. `§7` describes the shape: the rider disputes a number, "the block is lifted while the dispute is open",
 * and the amount stays outstanding *until somebody decides*. This route is that decision.
 *
 * **The accounting is a write-off, and the register says so.** `24 §6`'s row is "Shortfall written off:
 * `PLATFORM:EXPENSE_CASH_LOSS +amount`, `RIDER_CASH:{id} −amount`. Requires `SUPER_ADMIN` and a reason." This build has no
 * `EXPENSE_CASH_LOSS` account in its catalogue, so the credit goes to `PLATFORM:EXPENSE_COMPENSATION` — which is what the
 * platform is doing: making a rider whole for its own arithmetic. The permission is `finance.cash.write_off`, one of the
 * twenty-three step-up keys, because a route that makes a debt disappear is exactly the route a stolen session would use.
 *
 * **It is a reduction and only a reduction.** The amount comes off `collected_paisa`, the column the delivery totals were
 * credited to, and the statement refuses rather than clamps when the rider's balance is smaller than the figure. A
 * reviewer who meant to adjust upward is asking for a different route, and no route should do both directions behind one
 * button.
 *
 * **It can close the case that caused it.** An optional `declarationId` names the dispute or robbery being resolved, and
 * the declaration is closed in the same request — `resolved_at IS NULL` in the predicate, so two reviewers with the same
 * case open cannot both write it off. The note goes on both rows: the declaration carries what the next reviewer reads,
 * and the audit row carries what happened.
 */

/** What a reviewer sends to write off a balance. */
interface WriteOff {
  readonly amountPaisa: number;
  readonly reason: string;
  readonly note: string | null;
  readonly declarationId: string | null;
}

/** Parse the body, or the refusal that names the field. */
function parseWriteOff(
  body: unknown,
):
  | WriteOff
  | { readonly code: "VALIDATION_FAILED" | "MONEY_AMOUNT_NEGATIVE" | "VALIDATION_REQUIRED" | "VALIDATION_ID_MALFORMED"; readonly details: Record<string, unknown> } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { code: "VALIDATION_FAILED", details: { field: "body" } };
  }
  const raw = body as Record<string, unknown>;
  const amount = raw["amountPaisa"];
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return { code: "MONEY_AMOUNT_NEGATIVE", details: {} };
  }
  const reason = raw["reason"];
  if (typeof reason !== "string" || !reasonAllowed(reason, "finance.cash.write_off")) {
    return {
      code: "VALIDATION_REQUIRED",
      details: { fields: ["reason"], allowed: reasonsFor("finance.cash.write_off").map((entry) => entry.code) },
    };
  }
  const noteRaw = raw["note"] ?? null;
  if (noteRaw !== null && (typeof noteRaw !== "string" || noteRaw.trim().length > 280)) {
    return { code: "VALIDATION_REQUIRED", details: { fields: ["note"] } };
  }
  const declarationRaw = raw["declarationId"] ?? null;
  if (declarationRaw !== null && typeof declarationRaw !== "string") {
    return { code: "VALIDATION_ID_MALFORMED", details: { field: "declarationId" } };
  }
  return {
    amountPaisa: amount,
    reason,
    note: noteRaw === null ? null : (noteRaw as string).trim(),
    declarationId: declarationRaw === null ? null : (declarationRaw as string),
  };
}

/** A UUID as bytes, or `null` for anything that is not one. */
function idBytes(raw: string): Uint8Array | null {
  try {
    return uuidBytes(raw);
  } catch {
    return null;
  }
}

/**
 * Write off a balance: `POST /v1/finance/cash/riders/{id}/write-off` (D155).
 *
 * Four refusals before anything is written: a body that is not a body, an amount that is not a positive integer, a reason
 * outside the register, and a declaration that is not this rider's or is already resolved. Then the order is the same as
 * approval's (D143) and for the same reason: the balance is written down first, the ledger entry second, and a failure in
 * the entry puts the balance back — a rider whose debt vanished without an entry is money the books never saw.
 */
async function writeOff(ctx: Ctx, rawRiderId: string, body: unknown): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const riderBytes = idBytes(rawRiderId);
  if (riderBytes === null) {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", details: { field: "id" } }, ctx.locale, ctx.requestId);
  }

  const parsed = parseWriteOff(body);
  if ("code" in parsed) {
    return failureResponse({ code: parsed.code, details: parsed.details }, ctx.locale, ctx.requestId);
  }

  let adminBytes: Uint8Array;
  try {
    adminBytes = uuidBytes(ctx.principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_an_admin" } }, ctx.locale, ctx.requestId);
  }

  const collected = await cashCollectedPaisa(ctx.db, riderBytes);
  if (collected < parsed.amountPaisa) {
    // The reviewer's screen was stale, or a digit slipped: either way the balance cannot absorb this, and clamping would
    // turn a stated intention into whatever happened to be left.
    return failureResponse(
      { code: "MONEY_REFUND_EXCEEDS_PAID", details: { paid: collected, requested: parsed.amountPaisa } },
      ctx.locale,
      ctx.requestId,
    );
  }

  let declarationHex: string | null = null;
  if (parsed.declarationId !== null) {
    const declarationBytes = idBytes(parsed.declarationId);
    if (declarationBytes === null) {
      return failureResponse({ code: "VALIDATION_ID_MALFORMED", details: { field: "declarationId" } }, ctx.locale, ctx.requestId);
    }
    const declaration = await declarationById(ctx.db, declarationBytes);
    if (declaration === null || declaration.resolvedAt !== null) {
      // A case that is gone or already closed: the reviewer's list predates somebody else's decision.
      return failureResponse(
        { code: "CASH_ALREADY_SETTLED", details: { settled_at: declaration?.resolvedAt ?? new Date().toISOString() } },
        ctx.locale,
        ctx.requestId,
      );
    }
    declarationHex = toHexId(declarationBytes);
  }

  const nowMs = Date.now();
  const written = await writeOffBalance(ctx.db, riderBytes, parsed.amountPaisa, nowMs);
  if (!written) {
    return failureResponse({ code: "INTERNAL", details: { trace_id: ctx.requestId } }, ctx.locale, ctx.requestId);
  }

  let entryId: string;
  try {
    const posted = await postEntry(ctx.db, {
      entryType: "CASH_WRITE_OFF",
      description: `Cash written off for rider ${toHexId(riderBytes)}: ${parsed.amountPaisa} paisa`,
      postings: [
        { account: riderCashAccount(toHexId(riderBytes)), amountPaisa: -parsed.amountPaisa },
        { account: PLATFORM_ACCOUNTS.EXPENSE_COMPENSATION, amountPaisa: parsed.amountPaisa },
      ],
      createdBy: ctx.principal.userId,
      nowMs,
    });
    entryId = posted.entryId;
  } catch {
    // The books could not be written, so nothing happened: put the balance back and let the reviewer try again.
    await writeOffBalance(ctx.db, riderBytes, -parsed.amountPaisa, nowMs);
    return failureResponse({ code: "INTERNAL", details: { trace_id: ctx.requestId } }, ctx.locale, ctx.requestId);
  }

  let caseClosed = false;
  if (parsed.declarationId !== null) {
    const declarationBytes = uuidBytes(parsed.declarationId);
    caseClosed = await resolveDeclaration(ctx.db, declarationBytes, adminBytes, parsed.note, nowMs);
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
      action: "finance.cash.write_off",
      resourceType: declarationHex === null ? "RIDER_CASH_BALANCE" : "RIDER_CASH_DECLARATION",
      resourceId: declarationHex ?? toHexId(riderBytes),
      subjectId: toHexId(riderBytes),
      before: { shiftState: before, collectedPaisa: collected, outstandingPaisa: outstanding + parsed.amountPaisa },
      after: {
        shiftState: released ? "OFFLINE" : before,
        collectedPaisa: collected - parsed.amountPaisa,
        outstandingPaisa: outstanding,
        amountPaisa: parsed.amountPaisa,
        ledgerEntryId: entryId,
        caseClosed,
        note: parsed.note,
      },
      reason: parsed.reason,
      severity: "CRITICAL",
    },
    nowMs,
  );

  return successResponse(
    {
      adjustment: {
        amountPaisa: parsed.amountPaisa,
        ledgerEntryId: entryId,
        writtenOffAt: new Date(nowMs).toISOString(),
      },
      declarationId: declarationHex,
      caseClosed,
      outstandingPaisa: outstanding,
      released,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The finance write-off route (`08 §8`, D155): the one decision that admits the platform was wrong. */
export const CASH_WRITE_OFF_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/finance/cash/riders/{id}/write-off",
    // The step-up key, not `finance.cash.adjust`: this route makes a debt disappear, and `24 §6` names `write_off` as
    // the action that does so.
    permission: "finance.cash.write_off",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => writeOff(ctx, input.params["id"] ?? "", input.body),
  },
];

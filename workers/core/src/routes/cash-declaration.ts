/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { declarationCase } from "../repositories/declarations.ts";

/**
 * One cash case, read back (`25 §7`, D156).
 *
 * D154 built the list and D155 built the ending, and between them a reviewer could walk a case from "waiting" to
 * "resolved" without ever seeing it whole: the list carries the queue's columns, and the write-off hands back a
 * receipt. This route is the record — what the rider said, what the platform claimed then and claims now, and who
 * decided what, with the sentence they wrote.
 *
 * **One permission, still.** `finance.cash.list_outstanding` is the key that reads the list, so it is the key that reads
 * a row from it. A second read grant would let somebody who may see the morning's queue be refused a row in that queue
 * they can see, which is a rule nobody could explain to the person hitting it. The `ADMIN_WRITE` bucket is the same one
 * the list declares, for the same reason: it is one reviewer's requests, and the limiter counts them together.
 *
 * **What is deliberately absent.** No ledger entries are joined in. The write-off's postings are the finance trail
 * (D155, `24 §6`), readable through the ledger, and a case record that inlined them would be a second copy of the books
 * with its own correctness problem. The response says what a human needs to continue the conversation: the kind, the
 * sentence, the frozen arithmetic, the balance now, and the resolution.
 */

/** A UUID as bytes, or `null` for anything that is not one. */
function idBytes(raw: string): Uint8Array | null {
  try {
    return uuidBytes(raw);
  } catch {
    return null;
  }
}

/** Read one case: `GET /v1/finance/cash/declarations/{id}` (D156). */
async function readCase(ctx: Ctx, rawId: string): Promise<Response> {
  const id = idBytes(rawId);
  if (id === null) {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "id" }, ctx.locale, ctx.requestId);
  }
  const found = await declarationCase(ctx.db, id);
  if (found === null) {
    return failureResponse(
      { code: "CASH_DECLARATION_NOT_FOUND", details: { declaration_id: rawId } },
      ctx.locale,
      ctx.requestId,
    );
  }
  return successResponse(
    {
      case: {
        id: found.id,
        kind: found.kind,
        note: found.note,
        createdAt: found.createdAt,
        liftedUntil: found.liftedUntil,
        routedToReview: found.routedToReview,
        open: found.open,
        ownerId: found.ownerId,
        claimedAt: found.claimedAt,
        snapshot:
          found.snapshotDifferencePaisa === null && found.snapshotLinesPaisa === null
            ? null
            : { linesPaisa: found.snapshotLinesPaisa, differencePaisa: found.snapshotDifferencePaisa },
      },
      rider: {
        id: found.riderId,
        name: found.riderName,
        code: found.riderCode,
        phone: found.riderPhone,
        outstandingPaisa: found.outstandingPaisa,
      },
      resolution:
        found.resolvedAt === null
          ? null
          : {
              resolvedAt: found.resolvedAt,
              resolvedByName: found.resolvedByName,
              note: found.resolutionNote,
            },
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The finance case-read route (`08 §8`, D156): the record behind one row of D154's list. */
export const CASH_DECLARATION_ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/finance/cash/declarations/{id}",
    // The queue's key: a reviewer who may read the list may read a row of it.
    permission: "finance.cash.list_outstanding",
    group: "ADMIN_WRITE",
    run: async (ctx, input) => readCase(ctx, input.params["id"] ?? ""),
  },
];

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Ringing the vendor's phone when the order is placed (D93).
 *
 * The ladder itself lives in realtime — one `VendorAlarm` Durable Object per order, walking the rungs in
 * `14 §4.1` and cancelling at 120 s. Nothing in this Worker told it to start, so a placed order sat until an
 * operator noticed. This module is the missing sentence: *this order was published to this vendor, on these
 * devices, at this instant.*
 *
 * Two rules, and they are deliberately not the two rules the announcement follows (`D85`).
 *
 * 1. **The order is not waiting for the ring.** Placement is a money event: it writes rows and answers `201`.
 *    The ring is handed to `waitUntil`, so a cold room adds nothing to the customer's receipt.
 * 2. **A ring that failed is written down.** A missed broadcast degrades to a poll — the screen refetches. A
 *    missed ring means the vendor never learns, the ladder never starts, and the customer waits two minutes
 *    for a cancellation nobody chose. So a failure is an audit row at `WARNING`, and an order placed to a
 *    vendor with no registered device is recorded the same way: both are the platform failing to reach
 *    somebody, and neither is allowed to be silent.
 *
 * The push fields are the ones the order actually has. `totalPaisa` crosses as paisa because the client
 * formats it, and `attempt` is absent because each rung numbers its own (`BeginInput`).
 */

import { appendAudit } from "../audit/write.ts";
import { uuidBytes } from "../middleware/auth.ts";
import type { Ctx } from "../middleware/context.ts";
import {
  areaForAddress,
  deliveryAddressIdOf,
  tokensForUser,
  vendorOwnerUserId,
} from "../repositories/recipients.ts";

/** Where the ladder begins. */
export const LADDER_BEGIN_PATH = "/internal/ladder/begin";

/** How long a begin may take before the ring is abandoned for this request. */
export const LADDER_TIMEOUT_MS = 900;

/** How long the vendor has, start to cancellation. The ladder's own schedule is 120 s (`14 §4.1`). */
export const LADDER_WINDOW_MS = 120_000;

/** How long one attempt rings for, so the second attempt is audible over the first. */
export const ALARM_RING_MS = 20_000;

/** The order, as far as ringing is concerned. */
export interface RingRequest {
  /** The order's hex id, as the row is keyed. */
  readonly orderId: string;
  readonly orderCode: string;
  readonly zoneId: string;
  /** The vendor's hex id. */
  readonly vendorId: string;
  readonly itemCount: number;
  readonly totalPaisa: number;
  readonly publishedAtMs: number;
  /**
   * The vendor owner's user id, hex, when the caller has already resolved it (D104).
   *
   * The ring needs it to find the vendor's devices, and the announcement needs it to reach the vendor's own
   * channel. Passing it in means placement resolves it once instead of twice; omitting it leaves the ring to
   * look it up as before, so the binding still works for a caller with nothing else to say.
   */
  readonly ownerUserId?: string;
}

/** What the push says, in the shape realtime's `BeginInput.push` expects. */
export interface RingPush {
  readonly type: "ORDER_NEW";
  readonly severity: "CRITICAL";
  readonly orderId: string;
  readonly orderCode: string;
  readonly vendorId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly itemCount: number;
  readonly totalPaisa: number;
  readonly customerArea: string;
  readonly alarm: "loop";
  readonly alarmMaxMs: number;
}

/** The body of a begin. */
export interface LadderBeginInput {
  readonly orderCode: string;
  readonly zoneId: string;
  readonly devices: readonly string[];
  readonly publishedAtMs: number;
  readonly push: RingPush;
}

/** What the ring may be given, so a test can supply a transport. */
export interface LadderDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The short code a person reads out: `UND-7K2M9QX4` → `7K2M9QX4`. */
export function shortCode(orderCode: string): string {
  const dash = orderCode.lastIndexOf("-");
  return dash === -1 ? orderCode : orderCode.slice(dash + 1);
}

/** The body a ring sends. Exported so a test can assert it without a network. */
export function beginBody(request: RingRequest, tokens: readonly string[], area: string | null): LadderBeginInput {
  const orderCode = request.orderCode;
  const orderId = orderCode;
  return {
    orderCode,
    zoneId: request.zoneId,
    devices: [...tokens],
    publishedAtMs: request.publishedAtMs,
    push: {
      type: "ORDER_NEW",
      severity: "CRITICAL",
      orderId,
      orderCode: shortCode(orderCode),
      vendorId: request.vendorId,
      issuedAtMs: request.publishedAtMs,
      expiresAtMs: request.publishedAtMs + LADDER_WINDOW_MS,
      itemCount: request.itemCount,
      totalPaisa: request.totalPaisa,
      // An empty area is "not recorded", and it is a string so the client never has to handle absence
      // (`15 §2.1`). Whitespace is not an area: it trims here, at the last place before the wire.
      customerArea: area === null ? "" : area.trim(),
      alarm: "loop",
      alarmMaxMs: ALARM_RING_MS,
    },
  };
}

/** Ring one order's ladder. `true` means realtime accepted the begin. */
export async function beginLadder(
  baseUrl: string,
  token: string,
  input: LadderBeginInput,
  deps: LadderDeps = {},
): Promise<boolean> {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? LADDER_TIMEOUT_MS;
  const base = baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, timeoutMs);
  });
  try {
    const answer = await Promise.race([
      transport(`${base}${LADDER_BEGIN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
        signal: controller.signal,
      }),
      expired,
    ]);
    return answer instanceof Response ? answer.ok : false;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Resolve the recipients, ring them, and record a ring that did not happen.
 *
 * This is the function a route calls, and it never throws: the order is placed, and a notification problem is
 * evidence about the platform rather than a reason to fail the placement. What it will not do is stay quiet.
 */
export async function ringVendor(ctx: Ctx, request: RingRequest): Promise<void> {
  const base = ctx.env.REALTIME_BASE;
  const token = ctx.env.INTERNAL_TOKEN;
  // Not configured is not a failure: it is a deployment without the stream, and the placement says so to nobody.
  if (base === undefined || base === "" || token === undefined || token === "") return;

  const vendorId = uuidBytes(request.vendorId);
  const owner = request.ownerUserId === undefined ? await vendorOwnerUserId(ctx.db, vendorId) : uuidBytes(request.ownerUserId);
  const tokens = owner === null ? [] : await tokensForUser(ctx.db, owner);
  if (tokens.length === 0) {
    await recordUnrung(ctx, request, "no_device");
    return;
  }

  const addressId = await deliveryAddressIdOf(ctx.db, uuidBytes(request.orderId));
  const area = await areaForAddress(ctx.db, addressId);
  const rang = await beginLadder(base, token, beginBody(request, tokens, area));
  if (!rang) await recordUnrung(ctx, request, "begin_refused");
}

/** Write down a ring that did not reach anybody. */
async function recordUnrung(ctx: Ctx, request: RingRequest, reason: string): Promise<void> {
  await appendAudit(ctx.db, {
    actorId: null,
    actorType: "SYSTEM",
    actorRole: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "ladder.unrung",
    resourceType: "ORDER",
    resourceId: request.orderId,
    subjectId: null,
    before: null,
    after: { orderCode: request.orderCode, reason },
    reason: null,
    severity: "WARNING",
  }, request.publishedAtMs);
}

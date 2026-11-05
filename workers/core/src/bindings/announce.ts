/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Telling the watchers that an order moved (D85).
 *
 * Every transition in this Worker writes a row and answers the caller. None of them, until now, told the
 * people watching the order — so a customer's screen learned about an acceptance by polling, and the SSE
 * stream had nothing in it to stream. This module is the one line that closes that loop, and it is a
 * single line per call site because the decision it makes is always the same: *the broadcast is a
 * notification, and a notification that fails is not a reason to fail the order.*
 *
 * Three rules, all of them about not letting a push degrade a state machine:
 *
 * 1. **It never throws.** `createRealtimeClient` returns a `Result`; this module discards it. An order that
 *    moved is a fact whether or not the socket heard about it, and a Worker that rolled back a placement
 *    because the stream was cold would be a platform that loses money to its own notifications.
 * 2. **It never blocks the response.** The call is handed to `waitUntil`, so the transition's latency is the
 *    transition's, not the stream's 1 500 ms timeout.
 * 3. **It says nothing when it is not configured.** No `REALTIME_BASE` or no `INTERNAL_TOKEN` is a
 *    deployment that has not wired the stream; it is not an error, and it is not a reason to warn on every
 *    order.
 */

import type { Ctx } from "../middleware/context.ts";
import { createRealtimeClient } from "./realtime.ts";

/** What a transition tells the stream. */
export interface Announcement {
  /** The zone whose admin map should also see it. */
  readonly zoneId: string;
  /** The public order code, which is the channel id the clients subscribe to. */
  readonly orderId: string;
  /** The catalogue name from `08 §9.1`, e.g. `order.accepted`. */
  readonly event: string;
  /** The state the order is now in, plus anything the client would otherwise have to fetch. */
  readonly payload: Record<string, unknown>;
  /** The order's log sequence, so a resumed stream and a live one agree on order. */
  readonly seq?: number;
  /**
   * The users watching besides the customer and the zone (D104), by the id their own stream resolves `self` to.
   *
   * Omitted, the broadcast reaches the order channel and the zone channel only. That is not a silent default:
   * `channelsFor` publishes to exactly the channels the audience names, so a call site that wants the vendor's
   * other devices to see an acceptance has to say whose they are.
   */
  readonly audience?: { readonly vendorUserId?: string; readonly riderUserId?: string };
}

/**
 * Announce a transition, without waiting for it.
 *
 * The client is built per call rather than cached: `fetch` is the runtime's, the base URL is a binding, and a
 * module-level client would hold an `AbortController` factory across isolates that outlive it.
 */
export function announce(ctx: Ctx, announcement: Announcement): void {
  const base = ctx.env.REALTIME_BASE;
  const token = ctx.env.INTERNAL_TOKEN;
  if (base === undefined || base === "" || token === undefined || token === "") return;

  const client = createRealtimeClient(base, token);
  const sent = client.broadcast({
    zoneId: announcement.zoneId,
    orderId: announcement.orderId,
    event: announcement.event,
    payload: announcement.payload,
    ...(announcement.seq === undefined ? {} : { seq: announcement.seq }),
    ...(announcement.audience === undefined ? {} : { audience: announcement.audience }),
  });
  // `void` is deliberate: the `Result` is the client's business, the order is this Worker's.
  ctx.waitUntil(sent);
}

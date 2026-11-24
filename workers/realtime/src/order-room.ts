/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The Durable Object that fans one order's state events out to the people
 * watching it.
 *
 * It exists because an order has at most four watchers (customer, vendor, rider,
 * dispatcher) and they must all see the same sequence. A DO gives that ordering
 * for free; the free-tier `sql` backend achieves the same ordering with a
 * monotonic `order_state_events.seq`, at the cost of polling.
 */
export class OrderRoom {
  private readonly state: DurableObjectState;

  /** One room per order id, created on first connection. */
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Serve the room's own HTTP surface.
   *
   * `GET /seq` reports the last sequence number the room has broadcast, which is
   * what a reconnecting client uses to ask for exactly the events it missed
   * rather than replaying the whole order.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/seq" && request.method === "GET") {
      const seq = (await this.state.storage.get<number>("seq")) ?? 0;
      return new Response(JSON.stringify({ orderId: this.state.id.toString(), seq }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const body = (await request.json()) as { seq?: number };
      const current = (await this.state.storage.get<number>("seq")) ?? 0;
      const next = Math.max(current, body.seq ?? 0);
      // Single-key writes only: the free tier allows 100 000 of them a day and a
      // room that rewrites a list on every event would spend them in an afternoon.
      await this.state.storage.put("seq", next);
      return new Response(JSON.stringify({ seq: next }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_IMPLEMENTED" } }), {
      status: 501,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

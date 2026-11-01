/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, success } from "@undal/contracts";

export { OrderRoom } from "./order-room.ts";

/** The bindings this Worker is given by `wrangler.toml`. */
export interface RealtimeEnv {
  readonly PUBLIC_API_BASE: string;
  readonly PRESENCE_BACKEND: string;
  readonly ORDER_ROOM: DurableObjectNamespace;
}

/**
 * The Worker's fetch handler.
 *
 * `/health` reports which presence backend is live, because the two backends
 * have different cost and latency profiles and an operator looking at a p95
 * regression needs to know which one is running before changing anything.
 */
export default {
  async fetch(request: Request, env: RealtimeEnv): Promise<Response> {
    const url = new URL(request.url);
    const id = request.headers.get("X-Undal-Request-Id") ?? crypto.randomUUID();
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-Undal-Request-Id": id,
    };

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify(
          success(
            { worker: "undal-realtime", status: "ok", presenceBackend: env.PRESENCE_BACKEND },
            { requestId: id },
          ),
        ),
        { status: 200, headers },
      );
    }

    return new Response(
      JSON.stringify(failure("NOT_IMPLEMENTED", { requestId: id, details: { path: url.pathname } })),
      { status: 501, headers },
    );
  },
};

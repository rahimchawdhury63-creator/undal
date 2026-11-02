/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, success } from "@undal/contracts";

import { readCoordinatorMode } from "./lib/config.ts";

export { OrderRoom } from "./order-room.ts";

/** The bindings this Worker is given by `wrangler.toml`. */
export interface RealtimeEnv {
  readonly PUBLIC_API_BASE: string;
  /** `sql` or `durable-object`; see `readCoordinatorMode`. */
  readonly COORDINATION_MODE?: string;
  readonly ORDER_ROOM: DurableObjectNamespace;
}

/**
 * The Worker's fetch handler.
 *
 * `/health` reports which coordinator backend is live, because the two backends
 * have different cost and latency profiles and an operator looking at a p95
 * regression needs to know which one is running before changing anything. It
 * also refuses a `COORDINATION_MODE` it does not know, rather than running one
 * backend while the operator believes they configured the other.
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
      let coordinationMode;
      try {
        coordinationMode = readCoordinatorMode(env.COORDINATION_MODE);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
          JSON.stringify(failure("INTERNAL", { requestId: id, details: { misconfigured: message } })),
          { status: 500, headers },
        );
      }
      return new Response(
        JSON.stringify(
          success(
            { worker: "undal-realtime", status: "ok", coordinationMode },
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

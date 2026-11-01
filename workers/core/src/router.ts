/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, success } from "@undal/contracts";

/** A route: a method, a path pattern and the handler for it. */
export interface Route {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly handler: (request: Request, params: Record<string, string>) => Promise<Response>;
}

/** The slice of the Worker environment the router needs. */
export interface WorkerEnv {
  readonly PUBLIC_API_BASE: string;
  readonly LOG_LEVEL: string;
}

/** A request id, echoed on every response so one log line answers one call. */
function requestId(request: Request): string {
  const supplied = request.headers.get("X-Undal-Request-Id");
  return supplied !== null && supplied.length > 0 && supplied.length <= 64 ? supplied : crypto.randomUUID();
}

/**
 * Wrap an envelope in a `Response` with the JSON content type and no caching.
 *
 * API responses are never cached at the edge: an order's state changes for one
 * customer only, and a cached `QUOTED` order shown after acceptance is the kind
 * of bug that gets a rider sent to the wrong address.
 */
export function json(body: unknown, status: number, id: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-Undal-Request-Id": id,
    },
  });
}

/**
 * Build the dispatcher.
 *
 * Unknown paths return the envelope's 404 rather than HTML, because every client
 * of this Worker parses JSON and an HTML error page would surface as a parse
 * failure — losing the error code that says what actually happened.
 */
export function createRouter(routes: readonly Route[], env: WorkerEnv) {
  return async function route(request: Request): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);

    for (const candidate of routes) {
      if (candidate.method !== request.method) {
        continue;
      }
      if (candidate.path === url.pathname) {
        const response = await candidate.handler(request, {});
        response.headers.set("X-Undal-Request-Id", id);
        return response;
      }
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json(
        success({ worker: "undal-core", status: "ok", apiBase: env.PUBLIC_API_BASE }, { requestId: id }),
        200,
        id,
      );
    }

    // An unknown path on a versioned API is a request for a resource this build
    // does not serve, which is what `NOT_IMPLEMENTED` means. Answering `404`
    // would claim the resource exists somewhere else and send the client looking
    // for it; the details name exactly what was asked for.
    const body = failure("NOT_IMPLEMENTED", {
      requestId: id,
      details: { method: request.method, path: url.pathname },
    });
    return json(body, 501, id);
  };
}

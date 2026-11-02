/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The order-authorization port, answered by `undal-core` (`08 §9`, D82).
 *
 * The call is a `POST /internal/stream/watches` with the internal bearer token, and the answer is a yes or
 * a no. Everything else — a timeout, a 502, an HTTPS page where JSON should be, an envelope with `ok:false`
 * — is a no as well, and that is the whole design. This is the one place a stream decides whether to hand
 * somebody the contents of an order, so an unsettled answer has exactly one safe reading.
 *
 * The timeout is shorter than the client's patience on purpose. A browser that is told "no" reconnects and
 * asks again; a browser that is held while realtime waits on a slow core is a stream that has been open for
 * seconds without saying anything, which a mobile client reads as a dead connection.
 */

import type { OrderViewer, WatchQuestion } from "./order-viewer.ts";

/** Where core answers the question. */
export const WATCH_PATH = "/internal/stream/watches";

/** How long realtime waits for core before treating the silence as a refusal. */
export const CORE_WATCH_TIMEOUT_MS = 900;

/** What a `createCoreOrderViewer` call may be given, so a test can supply its own transport. */
export interface CoreOrderViewerDeps {
  /** The transport. Defaults to the runtime's `fetch`. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The envelope core answers with, as far as this client cares. */
interface WatchAnswer {
  readonly ok?: boolean;
  readonly data?: { readonly allowed?: boolean };
}

/**
 * Build the viewer.
 *
 * `baseUrl` is core's origin without a trailing slash; the trailing slash is stripped rather than trusted,
 * because `${base}/internal/...` with a base that already ends in `/` is `//internal/...`, and an edge that
 * normalises that differently from the origin is a 404 nobody can reproduce.
 */
export function createCoreOrderViewer(
  baseUrl: string,
  token: string,
  deps: CoreOrderViewerDeps = {},
): OrderViewer {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? CORE_WATCH_TIMEOUT_MS;
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async mayWatch(question: WatchQuestion): Promise<boolean> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await transport(`${base}${WATCH_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            actorId: question.actorId,
            actorType: question.actorType,
            orderId: question.orderId,
          }),
          signal: controller.signal,
        });
        // Status before body: a 502 from the edge has an HTML body, and `response.json()` on it throws a
        // message that reads like a timeout rather than a refusal.
        if (!response.ok) return false;
        const answer = (await response.json()) as WatchAnswer;
        return answer.ok === true && answer.data?.allowed === true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

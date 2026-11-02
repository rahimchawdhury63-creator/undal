/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The cancellation client.
 *
 * A refusal is an answer; a silence is not. The suite separates them, because the ladder's evidence block
 * records the difference: `not_cancellable` means a vendor answered, and a timeout means nobody knows.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CANCEL_PATH, createCoreCanceller } from "../src/authority/core-cancel.ts";

const BASE = "https://api.undal.app";
const TOKEN = "internal-secret";
const ASK = { orderCode: "UND-7K2M9QX4", elapsedSeconds: 120 };

/** A transport that records the request and answers with a script. */
function stub(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return answer(String(input), init ?? {});
  }) as typeof fetch;
  return { calls, transport };
}

describe("asking core to cancel", () => {
  test("posts the code and the elapsed time under the internal token", async () => {
    const { calls, transport } = stub(async () =>
      Response.json({ ok: true, data: { cancelled: true, reason: "cancelled", state: "AUTO_CANCELLED" } }),
    );
    const answer = await createCoreCanceller(BASE, TOKEN, { fetch: transport }).cancel(ASK);
    assert.deepEqual(answer, { cancelled: true, reason: "cancelled" });
    assert.equal(calls[0]?.url, `${BASE}${CANCEL_PATH}`);
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), ASK);
  });

  test("a trailing slash on the base is not doubled", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { cancelled: true, reason: "cancelled" } }));
    await createCoreCanceller(`${BASE}/`, TOKEN, { fetch: transport }).cancel(ASK);
    assert.equal(calls[0]?.url, `${BASE}${CANCEL_PATH}`);
  });

  test("a refusal is returned, not thrown: the ladder records why", async () => {
    const { transport } = stub(async () =>
      Response.json({ ok: true, data: { cancelled: false, reason: "not_cancellable", state: "ACCEPTED" } }),
    );
    assert.deepEqual(await createCoreCanceller(BASE, TOKEN, { fetch: transport }).cancel(ASK), {
      cancelled: false,
      reason: "not_cancellable",
    });
  });

  test("a non-2xx throws, because silence is not an answer", async () => {
    const { transport } = stub(async () => new Response("boom", { status: 503 }));
    await assert.rejects(createCoreCanceller(BASE, TOKEN, { fetch: transport }).cancel(ASK), /auto-cancel refused: 503/u);
  });

  test("an envelope with ok:false throws rather than reading as a refusal", async () => {
    const { transport } = stub(async () => Response.json({ ok: false, error: { code: "AUTH_TOKEN_INVALID" } }));
    await assert.rejects(createCoreCanceller(BASE, TOKEN, { fetch: transport }).cancel(ASK), /outside the envelope/u);
  });

  test("a transport that never answers is abandoned at the timeout, as a throw", async () => {
    const { transport } = stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    await assert.rejects(createCoreCanceller(BASE, TOKEN, { fetch: transport, timeoutMs: 20 }).cancel(ASK));
  });
});

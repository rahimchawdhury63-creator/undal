/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The dispatch tick's two calls (`11 §7`, D130).
 *
 * The assertions are about what a stale wave costs: the tick must expire first (the orders it answers with are the only
 * ones worth advancing), it must not invent an advance from a `null` wave, and a failed call must leave the state as it
 * was so the next alarm retries rather than skipping the order forever.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ADVANCE_PATH, EXPIRE_PATH, createCoreWave } from "../src/authority/core-wave.ts";

const BASE = "https://core.undal.app";
const TOKEN = "internal-secret";

interface Call {
  readonly url: string;
  readonly body: unknown;
}

function transport(answers: readonly (() => Response)[]): { readonly calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    const make = answers[index] ?? answers[answers.length - 1];
    index += 1;
    if (make === undefined) throw new Error("no answer");
    return make();
  }) as typeof fetch;
  return { calls };
}

const realFetch = globalThis.fetch;
import { afterEach } from "node:test";
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the dispatch tick (D130)", () => {
  test("a tick with nothing expired is one round trip and no advances", async () => {
    const stub = transport([() => Response.json({ ok: true, data: { expired: 0, waves: [], orders: [] } })]);
    const tick = await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick();
    assert.deepEqual(tick, { expired: 0, advanced: 0 });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]?.url, `${BASE}${EXPIRE_PATH}`);
  });

  test("each order the sweep emptied is advanced, with its code", async () => {
    const stub = transport([
      () => Response.json({ ok: true, data: { expired: 4, waves: [1], orders: ["UND-7K2M9QX4", "UND-8A3B"] } }),
      () => Response.json({ ok: true, data: { wave: 2 } }),
      () => Response.json({ ok: true, data: { wave: 2 } }),
    ]);
    const tick = await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick();
    assert.deepEqual(tick, { expired: 4, advanced: 2 });
    assert.equal(stub.calls[1]?.url, `${BASE}${ADVANCE_PATH}`);
    assert.deepEqual(stub.calls[1]?.body, { orderCode: "UND-7K2M9QX4" });
    assert.deepEqual(stub.calls[2]?.body, { orderCode: "UND-8A3B" });
  });

  test("a null wave is an answer — nobody eligible or ladder exhausted — not an advance", async () => {
    transport([
      () => Response.json({ ok: true, data: { expired: 3, waves: [5], orders: ["UND-7K2M9QX4"] } }),
      () => Response.json({ ok: true, data: { wave: null, reason: "LADDER_EXHAUSTED" } }),
    ]);
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), { expired: 3, advanced: 0 });
  });

  test("a refused call leaves the state alone, so the next alarm retries", async () => {
    transport([() => new Response("nope", { status: 500 })]);
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), { expired: 0, advanced: 0 });
  });

  test("a dead transport is not an advance either", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), { expired: 0, advanced: 0 });
  });

  test("the token travels on both calls, and the sweep carries an empty body", async () => {
    const stub = transport([
      () => Response.json({ ok: true, data: { expired: 0, waves: [], orders: [] } }),
    ]);
    await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick();
    assert.deepEqual(stub.calls[0]?.body, {});
  });
});

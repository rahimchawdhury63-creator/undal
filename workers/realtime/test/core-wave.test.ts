/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The dispatch tick's three calls (`11 §7`, D130, D131).
 *
 * The assertions are about what a stale wave costs: the tick must expire first (the orders it answers with are the only
 * ones worth advancing), it must not invent an advance from a `null` wave, and a failed call must leave the state as it
 * was so the next alarm retries rather than skipping the order forever. The retry pass comes last and is a count, not a
 * decision: a wave it could not re-ring is one the next tick — seconds away — asks about again.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ADVANCE_PATH, EXPIRE_PATH, RETRY_PATH, createCoreWave } from "../src/authority/core-wave.ts";

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

const EMPTY_EXPIRY = () => Response.json({ ok: true, data: { expired: 0, waves: [], orders: [] } });
const NOTHING_RETRIED = () => Response.json({ ok: true, data: { retried: 0, sent: 0, failed: 0 } });

describe("the dispatch tick (D130, D131)", () => {
  test("a tick with nothing expired and nothing failed is two round trips and no work", async () => {
    const stub = transport([EMPTY_EXPIRY, NOTHING_RETRIED]);
    const tick = await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick();
    assert.deepEqual(tick, { expired: 0, advanced: 0, retried: 0 });
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0]?.url, `${BASE}${EXPIRE_PATH}`);
    assert.equal(stub.calls[1]?.url, `${BASE}${RETRY_PATH}`);
  });

  test("each order the sweep emptied is advanced, with its code, and the retry pass runs last", async () => {
    const stub = transport([
      () => Response.json({ ok: true, data: { expired: 4, waves: [1], orders: ["UND-7K2M9QX4", "UND-8A3B"] } }),
      () => Response.json({ ok: true, data: { wave: 2 } }),
      () => Response.json({ ok: true, data: { wave: 2 } }),
      () => Response.json({ ok: true, data: { retried: 3, sent: 2, failed: 1 } }),
    ]);
    const tick = await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick();
    assert.deepEqual(tick, { expired: 4, advanced: 2, retried: 3 });
    assert.equal(stub.calls[1]?.url, `${BASE}${ADVANCE_PATH}`);
    assert.deepEqual(stub.calls[1]?.body, { orderCode: "UND-7K2M9QX4" });
    assert.deepEqual(stub.calls[2]?.body, { orderCode: "UND-8A3B" });
    // A wave just planned has just pushed; its failures are exactly what the pass is for, so it cannot come first.
    assert.deepEqual(stub.calls[3]?.url, `${BASE}${RETRY_PATH}`);
  });

  test("a null wave is an answer — nobody eligible or ladder exhausted — not an advance", async () => {
    transport([
      () => Response.json({ ok: true, data: { expired: 3, waves: [5], orders: ["UND-7K2M9QX4"] } }),
      () => Response.json({ ok: true, data: { wave: null, reason: "LADDER_EXHAUSTED" } }),
      NOTHING_RETRIED,
    ]);
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), {
      expired: 3,
      advanced: 0,
      retried: 0,
    });
  });

  test("a refused call leaves the state alone, so the next alarm retries", async () => {
    transport([() => new Response("nope", { status: 500 })]);
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), {
      expired: 0,
      advanced: 0,
      retried: 0,
    });
  });

  test("a dead transport is not an advance either", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), {
      expired: 0,
      advanced: 0,
      retried: 0,
    });
  });

  test("the token travels on every call, and both sweeps carry an empty body", async () => {
    const stub = transport([EMPTY_EXPIRY, NOTHING_RETRIED]);
    await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick();
    assert.deepEqual(stub.calls[0]?.body, {});
    assert.deepEqual(stub.calls[1]?.body, {});
  });

  test("a failed retry pass is a zero, not a throw: the offers are still live next tick", async () => {
    const stub = transport([EMPTY_EXPIRY, () => new Response("upstream", { status: 503 })]);
    assert.deepEqual(await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick(), {
      expired: 0,
      advanced: 0,
      retried: 0,
    });
    assert.equal(stub.calls.length, 2);
  });

  test("an answer that is not an envelope is not a count", async () => {
    transport([EMPTY_EXPIRY, () => Response.json({ retried: 9, sent: 9, failed: 0 })]);
    assert.equal((await createCoreWave({ baseUrl: BASE, token: TOKEN }).tick()).retried, 0);
  });
});

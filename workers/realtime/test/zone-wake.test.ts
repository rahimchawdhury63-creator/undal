/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Waking a zone room from the announcement, and the room's answer (`11 §7`, D132).
 *
 * Two halves, and they fail differently. The client (`zoneWake`) must address the *same* room a socket would
 * (`zone:{id}`), carry the instants in a body the room can validate, and treat an unreachable room as a missed wake
 * rather than as a failed broadcast. The room's `/internal/wake` must remember a zone it has never been connected to —
 * the first wave in a new zone is precisely the wave that arrives at a room with no history — and refuse a body that
 * names no instant, because an alarm set to a time that never comes is a room that never ticks again.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { zoneWake, ZONE_WAKE_PATH } from "../src/hubs/zone-wake.ts";
import type { WakeNamespace } from "../src/hubs/zone-wake.ts";
import { MAX_WAKE_INSTANTS, readWakeInstants, WAKE_PATH, ZONE_KEY } from "../src/hubs/zone-hub.ts";

const T0 = 1_700_000_000_000;

/** A namespace that records the names it was asked for and the requests it was handed. */
function namespace(answer: () => Promise<Response> | Response = () => new Response("{}", { status: 200 })) {
  const asked: string[] = [];
  const requests: Request[] = [];
  const made: WakeNamespace = {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => ({
      fetch: async (request: Request) => {
        asked.push(id.toString());
        requests.push(request);
        return answer();
      },
    }),
  };
  return { made, asked, requests };
}

describe("the wake client (D132)", () => {
  test("it addresses the same room a socket does, and names the instants", async () => {
    const stub = namespace();
    const wake = zoneWake({ namespace: stub.made });
    assert.equal(await wake("zone-1", [T0 + 3_000, T0 + 26_000]), true);
    assert.deepEqual(stub.asked, ["zone:zone-1"], "a second naming scheme would be a second empty room");
    const request = stub.requests[0];
    assert.equal(new URL(request?.url ?? "").pathname, ZONE_WAKE_PATH);
    assert.equal(new URL(request?.url ?? "").searchParams.get("zone"), "zone-1");
    assert.deepEqual(await request?.json(), { atMs: [T0 + 3_000, T0 + 26_000] });
  });

  test("nothing to arm is no call at all", async () => {
    const stub = namespace();
    const wake = zoneWake({ namespace: stub.made });
    assert.equal(await wake("zone-1", []), false);
    assert.equal(await wake("", [T0]), false);
    assert.equal(stub.asked.length, 0, "a broadcast with no deadline must not wake the room");
  });

  test("a refused wake is false, and does not throw into the broadcast", async () => {
    const refused = namespace(() => new Response("{}", { status: 503 }));
    assert.equal(await zoneWake({ namespace: refused.made })("zone-1", [T0]), false);
    const dead = namespace(() => {
      throw new Error("room unavailable");
    });
    assert.equal(await zoneWake({ namespace: dead.made })("zone-1", [T0]), false);
  });
});

describe("the wake body (D132)", () => {
  test("a list of instants is accepted, and anything else is refused", () => {
    assert.deepEqual(readWakeInstants({ atMs: [T0, T0 + 1] }), [T0, T0 + 1]);
    assert.deepEqual(readWakeInstants({ atMs: [T0 + 0.6] }), [T0], "a fractional instant is truncated, not rejected");
    assert.equal(readWakeInstants({ atMs: [] }), null);
    assert.equal(readWakeInstants({ atMs: [T0, "soon"] }), null);
    assert.equal(readWakeInstants({ atMs: [0] }), null, "an epoch instant is not a deadline");
    assert.equal(readWakeInstants({ atMs: [Number.NaN] }), null);
    assert.equal(readWakeInstants({}), null);
    assert.equal(readWakeInstants(null), null);
    const tooMany = Array.from({ length: MAX_WAKE_INSTANTS + 1 }, (_, index) => T0 + index);
    assert.equal(readWakeInstants({ atMs: tooMany }), null, "a caller may not fill the room's list");
  });

  test("the path is the one the client posts to", () => {
    assert.equal(WAKE_PATH, ZONE_WAKE_PATH, "the route and the client must not drift");
    assert.equal(ZONE_KEY, "zone:id");
  });
});

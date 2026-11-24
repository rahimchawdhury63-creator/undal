/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The coordination suite: the same assertions against both backends.
 *
 * Every dispatch, presence and event test in this file runs twice — once through the Durable Object
 * room's RPC surface, once through the `sql` coordinator and the conditional `UPDATE`. That is the
 * promise `05 §4.2` makes: two implementations, one behaviour, and the free path is not a stub. The
 * 50-way claim is the case that matters; if it ever passes on one backend and fails on the other, the
 * backend that passed is the one to distrust first.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FixedClock } from "../src/lib/clock.ts";
import { claimState, nextSeq, openState } from "../src/coordination/machine.ts";
import {
  DISPATCH_LEASE_MS,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  clampLease,
  leaseExpired,
  leaseFrom,
  renewLease,
} from "../src/coordination/lease.ts";
import {
  EVENT_PAGE_LIMIT,
  HEARTBEAT_DEADLINE_MS,
  type OpenDispatchInput,
  type WavePlan,
} from "../src/coordination/coordinator.ts";
import { TiDBCoordinator } from "../src/coordination/tidb.ts";
import { MemorySql, MemoryStore, STATEMENTS } from "./support/fakes.ts";
import { BACKENDS, T0 } from "./support/backends.ts";

/** A two-wave plan: two riders now, one at T+25 s. */
function waves(at: number = T0): WavePlan[] {
  return [
    { wave: 1, riderIds: ["rider-a", "rider-b"], startsAtMs: at, expiresAtMs: at + 25_000 },
    { wave: 2, riderIds: ["rider-c"], startsAtMs: at + 25_000, expiresAtMs: at + 50_000 },
  ];
}

function plan(orderId = "order-1", at: number = T0): OpenDispatchInput {
  return { orderId, zoneId: "zone-1", waves: waves(at) };
}

for (const backend of BACKENDS) {
  describe(`coordinator/${backend.name}`, () => {
    describe("dispatch", () => {
      test("a plan opens and stores every wave", async () => {
        const { coordinator } = backend.make();
        const state = await coordinator.openDispatch(plan());
        assert.equal(state.phase, "OPEN");
        assert.equal(state.currentWave, 0);
        assert.deepEqual(state.waves.map((wave) => wave.riderIds), [["rider-a", "rider-b"], ["rider-c"]]);
        assert.deepEqual(await coordinator.getDispatch("order-1"), state);
      });

      test("opening twice is a no-op, not a second cascade", async () => {
        const { coordinator } = backend.make();
        const first = await coordinator.openDispatch(plan());
        const second = await coordinator.openDispatch(plan());
        assert.deepEqual(second, first);
      });

      test("a plan that rings one rider twice is refused", async () => {
        const { coordinator } = backend.make();
        const doubled: OpenDispatchInput = {
          orderId: "order-1",
          zoneId: "zone-1",
          waves: [
            { wave: 1, riderIds: ["rider-a", "rider-b"], startsAtMs: T0, expiresAtMs: T0 + 25_000 },
            { wave: 2, riderIds: ["rider-b"], startsAtMs: T0 + 25_000, expiresAtMs: T0 + 50_000 },
          ],
        };
        await assert.rejects(() => coordinator.openDispatch(doubled), /appears in two waves/gu);
      });

      test("a gap in the wave numbers is refused", async () => {
        const { coordinator } = backend.make();
        const gapped: OpenDispatchInput = {
          orderId: "order-1",
          zoneId: "zone-1",
          waves: [{ wave: 2, riderIds: ["rider-a"], startsAtMs: T0, expiresAtMs: T0 + 25_000 }],
        };
        await assert.rejects(() => coordinator.openDispatch(gapped), /without gaps/gu);
      });

      test("a rider in the current wave wins", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.advanceWave("order-1");
        const result = await coordinator.claimOffer("order-1", "rider-a");
        assert.equal(result.ok, true);
        assert.equal(result.code, "OK");
        assert.equal(result.claimedBy, "rider-a");
        assert.equal(result.wave, 1);
        const state = await coordinator.getDispatch("order-1");
        assert.equal(state?.phase, "ASSIGNED");
        assert.equal(state?.claimedBy, "rider-a");
      });

      test("a rider who was never asked is refused with OFFER_NOT_TARGETED", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.advanceWave("order-1");
        const result = await coordinator.claimOffer("order-1", "rider-z");
        assert.equal(result.ok, false);
        assert.equal(result.code, "OFFER_NOT_TARGETED");
      });

      test("a claim before any wave has fired is refused", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        const result = await coordinator.claimOffer("order-1", "rider-a");
        assert.equal(result.ok, false);
        assert.equal(result.code, "OFFER_WAVE_CLOSED");
      });

      test("a claim after the wave expired is refused with OFFER_EXPIRED", async () => {
        const { coordinator, clock } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.advanceWave("order-1");
        clock.advance(25_001);
        const result = await coordinator.claimOffer("order-1", "rider-a");
        assert.equal(result.ok, false);
        assert.equal(result.code, "OFFER_EXPIRED");
      });

      test("the second rider loses with OFFER_CLAIMED", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.advanceWave("order-1");
        assert.equal((await coordinator.claimOffer("order-1", "rider-a")).ok, true);
        const loser = await coordinator.claimOffer("order-1", "rider-b");
        assert.equal(loser.ok, false);
        assert.equal(loser.code, "OFFER_CLAIMED");
        assert.equal(loser.claimedBy, "rider-a");
      });

      test("the winner's repeat claim is a success, not a conflict", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.advanceWave("order-1");
        assert.equal((await coordinator.claimOffer("order-1", "rider-a")).ok, true);
        const again = await coordinator.claimOffer("order-1", "rider-a");
        assert.equal(again.ok, true);
        assert.equal(again.code, "OK");
      });

      test("a rider who rejected cannot claim the same order", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.advanceWave("order-1");
        await coordinator.withdrawOffer("order-1", "rider-a", "TOO_FAR");
        const result = await coordinator.claimOffer("order-1", "rider-a");
        assert.equal(result.ok, false);
        assert.equal(result.code, "OFFER_WAVE_CLOSED");
        const state = await coordinator.getDispatch("order-1");
        assert.deepEqual(state?.rejected, ["rider-a"]);
      });

      test("withdrawing twice records one rejection", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await coordinator.withdrawOffer("order-1", "rider-a", "TOO_FAR");
        const state = await coordinator.withdrawOffer("order-1", "rider-a", "TOO_FAR");
        assert.deepEqual(state.rejected, ["rider-a"]);
      });

      test("advancing fires each wave once and then moves to the ladder", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        assert.equal((await coordinator.advanceWave("order-1")).currentWave, 1);
        assert.equal((await coordinator.advanceWave("order-1")).currentWave, 2);
        const exhausted = await coordinator.advanceWave("order-1");
        assert.equal(exhausted.phase, "FALLBACK");
        assert.equal(exhausted.closedReason, "FALLBACK");
      });

      test("closing as ASSIGNED without a claim is refused", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        await assert.rejects(() => coordinator.closeDispatch("order-1", "ASSIGNED"), /without a claim/gu);
      });

      test("closing is idempotent and keeps the first reason", async () => {
        const { coordinator } = backend.make();
        await coordinator.openDispatch(plan());
        const first = await coordinator.closeDispatch("order-1", "CANCELLED");
        const second = await coordinator.closeDispatch("order-1", "FALLBACK");
        assert.equal(first.phase, "CANCELLED");
        assert.equal(second.closedReason, "CANCELLED");
      });

      test("fifty simultaneous claims produce exactly one winner", async () => {
        const { coordinator } = backend.make();
        const riders = Array.from({ length: 50 }, (_, index) => `rider-${String(index).padStart(2, "0")}`);
        await coordinator.openDispatch({
          orderId: "order-race",
          zoneId: "zone-1",
          waves: [{ wave: 1, riderIds: riders, startsAtMs: T0, expiresAtMs: T0 + 25_000 }],
        });
        await coordinator.advanceWave("order-race");
        const results = await Promise.all(riders.map((riderId) => coordinator.claimOffer("order-race", riderId)));
        assert.equal(results.filter((result) => result.ok).length, 1);
        assert.equal(results.filter((result) => result.code === "OFFER_CLAIMED").length, 49);
        const state = await coordinator.getDispatch("order-race");
        assert.ok(state?.claimedBy !== null);
      });

      test("a claim on an order with no cascade is refused rather than thrown", async () => {
        const { coordinator } = backend.make();
        const result = await coordinator.claimOffer("order-missing", "rider-a");
        assert.equal(result.ok, false);
        assert.equal(result.code, "OFFER_WAVE_CLOSED");
      });
    });

    describe("presence", () => {
      test("a declared device appears in the zone list", async () => {
        const { coordinator } = backend.make();
        const session = await coordinator.declarePresence({
          actorId: "rider-a",
          deviceId: "device-1",
          role: "RIDER",
          zoneId: "zone-1",
        });
        assert.equal(session.seq, 0);
        const list = await coordinator.listPresence("zone-1");
        assert.equal(list.length, 1);
        assert.equal(list[0]?.actorId, "rider-a");
      });

      test("the list filters by role", async () => {
        const { coordinator } = backend.make();
        await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
        await coordinator.declarePresence({ actorId: "vendor-a", deviceId: "d2", role: "PARTNER", zoneId: "zone-1" });
        assert.equal((await coordinator.listPresence("zone-1", "RIDER")).length, 1);
        assert.equal((await coordinator.listPresence("zone-1", "PARTNER")).length, 1);
        assert.equal((await coordinator.listPresence("zone-1")).length, 2);
        assert.equal((await coordinator.listPresence("zone-2")).length, 0);
      });

      test("a heartbeat echoes its sequence and buys two seconds", async () => {
        const { coordinator, clock } = backend.make();
        await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
        clock.advance(750);
        const ack = await coordinator.heartbeat("zone-1", "rider-a", "d1", 4);
        assert.equal(ack.known, true);
        assert.equal(ack.seq, 4);
        assert.equal(ack.nowMs, T0 + 750);
        assert.equal(ack.deadlineMs, T0 + 750 + HEARTBEAT_DEADLINE_MS);
      });

      test("a heartbeat from a device that is not connected says so", async () => {
        const { coordinator } = backend.make();
        const ack = await coordinator.heartbeat("zone-1", "rider-z", "d9", 1);
        assert.equal(ack.known, false);
        assert.equal(ack.deadlineMs, T0 + HEARTBEAT_DEADLINE_MS);
      });

      test("marking absent removes the session and a second call is a no-op", async () => {
        const { coordinator } = backend.make();
        await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
        await coordinator.markAbsent("zone-1", "rider-a", "d1", "TRANSPORT_CLOSED");
        await coordinator.markAbsent("zone-1", "rider-a", "d1", "TRANSPORT_CLOSED");
        assert.equal((await coordinator.listPresence("zone-1")).length, 0);
      });

      test("a reconnect inside the grace window replaces the session, it does not duplicate it", async () => {
        const { coordinator, clock } = backend.make();
        const first = await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
        clock.advance(1_000);
        const second = await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
        assert.equal((await coordinator.listPresence("zone-1")).length, 1);
        assert.ok(second.connectedAtMs >= first.connectedAtMs);
      });

      test("a snapshot counts each role and the zone's open dispatches", async () => {
        const { coordinator } = backend.make();
        await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
        await coordinator.declarePresence({ actorId: "vendor-a", deviceId: "d2", role: "PARTNER", zoneId: "zone-1" });
        await coordinator.openDispatch(plan());
        const snapshot = await coordinator.snapshot("zone-1");
        assert.equal(snapshot.presence.RIDER, 1);
        assert.equal(snapshot.presence.PARTNER, 1);
        assert.equal(snapshot.presence.CUSTOMER, 0);
        assert.equal(snapshot.openDispatches, 1);
        await coordinator.closeDispatch("order-1", "CANCELLED");
        assert.equal((await coordinator.snapshot("zone-1")).openDispatches, 0);
      });
    });

    describe("events", () => {
      test("appends are numbered from one", async () => {
        const { coordinator } = backend.make();
        const first = await coordinator.appendEvent({ orderId: "order-1", kind: "PLACED", actorType: "CUSTOMER" });
        const second = await coordinator.appendEvent({ orderId: "order-1", kind: "ACCEPTED", actorType: "VENDOR" });
        assert.equal(first.seq, 1);
        assert.equal(second.seq, 2);
        assert.equal(first.actorId, null);
      });

      test("a replay returns only what came after the cursor", async () => {
        const { coordinator } = backend.make();
        for (const kind of ["PLACED", "ACCEPTED", "RIDER_ASSIGNED"]) {
          await coordinator.appendEvent({ orderId: "order-1", kind, actorType: "SYSTEM" });
        }
        const tail = await coordinator.readEvents("order-1", 1);
        assert.deepEqual(tail.map((event) => event.kind), ["ACCEPTED", "RIDER_ASSIGNED"]);
        assert.deepEqual((await coordinator.readEvents("order-1", 3)).map((event) => event.seq), []);
      });

      test("a replay respects the page limit", async () => {
        const { coordinator } = backend.make();
        for (let index = 0; index < 5; index += 1) {
          await coordinator.appendEvent({ orderId: "order-1", kind: `K${index}`, actorType: "SYSTEM" });
        }
        assert.equal((await coordinator.readEvents("order-1", 0, 2)).length, 2);
        assert.equal((await coordinator.readEvents("order-1", 0, 10_000)).length, 5);
        assert.ok(EVENT_PAGE_LIMIT >= 5);
      });

      test("the payload and actor survive the round trip", async () => {
        const { coordinator } = backend.make();
        const event = await coordinator.appendEvent({
          orderId: "order-1",
          kind: "RIDER_ASSIGNED",
          actorType: "RIDER",
          actorId: "rider-a",
          payload: { wave: 1, payoutPaisa: 45_000 },
        });
        const [stored] = await coordinator.readEvents("order-1", 0);
        assert.deepEqual(stored?.payload, { wave: 1, payoutPaisa: 45_000 });
        assert.equal(stored?.actorId, "rider-a");
        assert.equal(stored?.seq, event.seq);
      });

      test("health names the live backend", async () => {
        const { coordinator } = backend.make();
        const health = await coordinator.health();
        assert.equal(health.ok, true);
        assert.equal(health.backend, backend.name);
      });
    });
  });
}

describe("lease", () => {
  test("a lease covers its expiry instant and not the millisecond after", () => {
    const lease = leaseFrom(T0);
    assert.equal(lease.untilMs, T0 + DISPATCH_LEASE_MS);
    assert.equal(leaseExpired(lease, T0 + DISPATCH_LEASE_MS), false);
    assert.equal(leaseExpired(lease, T0 + DISPATCH_LEASE_MS + 1), true);
  });

  test("a configured lease cannot escape the cascade's range", () => {
    assert.equal(clampLease(0), MIN_LEASE_MS);
    assert.equal(clampLease(10 * MAX_LEASE_MS), MAX_LEASE_MS);
    assert.equal(clampLease(DISPATCH_LEASE_MS), DISPATCH_LEASE_MS);
    assert.throws(() => clampLease(Number.NaN), RangeError);
  });

  test("renewing never shortens a live lease", () => {
    const lease = leaseFrom(T0);
    assert.equal(renewLease(lease, T0 + 1_000).untilMs, T0 + 1_000 + DISPATCH_LEASE_MS);
    assert.ok(renewLease(lease, T0 + 60_000).untilMs >= T0 + 60_000 + MIN_LEASE_MS);
  });
});

describe("machine", () => {
  test("a losing claim leaves the state untouched", () => {
    const state = openState(plan(), T0);
    const { state: after, result } = claimState(state, "rider-a", T0);
    assert.equal(result.ok, false);
    assert.equal(after, state);
  });

  test("an excluded rider may not appear in the plan", () => {
    assert.throws(
      () => openState({ ...plan(), excludeRiderId: "rider-a" }, T0),
      RangeError,
    );
  });

  test("the next sequence number is one past the highest, not the count", () => {
    assert.equal(nextSeq([]), 1);
    assert.equal(nextSeq([{ seq: 1 }, { seq: 7 }, { seq: 3 }]), 8);
  });
});

describe("the sql claim is one conditional statement", () => {
  test("the lock is decided in the WHERE clause, not in JavaScript", async () => {
    const clock = new FixedClock(T0);
    const sql = new MemorySql();
    const coordinator = new TiDBCoordinator(sql, new MemoryStore(), clock);
    await coordinator.openDispatch(plan());
    await coordinator.advanceWave("order-1");
    assert.equal((await coordinator.claimOffer("order-1", "rider-a")).ok, true);
    const claims = sql.ran("UPDATE dispatch_locks");
    assert.equal(claims.length, 1);
    assert.equal(claims[0], STATEMENTS.CLAIM_SQL);
    assert.match(STATEMENTS.CLAIM_SQL, /WHERE order_id = UNHEX\(\?\)/u);
    assert.match(STATEMENTS.CLAIM_SQL, /expires_at < \?/u);
  });

  test("a lost event-sequence race is retried rather than lost", async () => {
    const clock = new FixedClock(T0);
    const sql = new MemorySql();
    const coordinator = new TiDBCoordinator(sql, new MemoryStore(), clock);
    sql.duplicateOnNextInsert = true;
    const event = await coordinator.appendEvent({ orderId: "order-1", kind: "PLACED", actorType: "CUSTOMER" });
    assert.equal(event.seq, 1);
    assert.equal(sql.events.length, 1);
  });

  test("health reports a database that will not answer", async () => {
    const clock = new FixedClock(T0);
    const sql = new MemorySql();
    sql.failHealth = true;
    const coordinator = new TiDBCoordinator(sql, new MemoryStore(), clock);
    const health = await coordinator.health();
    assert.equal(health.ok, false);
    assert.equal(health.backend, "sql");
  });
});

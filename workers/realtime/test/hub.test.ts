/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The presence hub, end to end: a socket connects, beats, drops, and is published — on both backends.
 *
 * Nothing here sleeps. The hub reads a `FixedClock` and takes its alarm as a call, so "the alarm fires
 * two seconds later" is a number the test sets rather than a wall clock it waits for.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FixedClock } from "../src/lib/clock.ts";
import { PresenceHub } from "../src/hubs/presence-hub.ts";
import type { HubSocket, HubStorage } from "../src/hubs/presence-hub.ts";
import type { AbsenceRecord } from "../src/presence/ledger.ts";
import { CLOSE_GOING_OFFLINE, CLOSE_HEARTBEAT_TIMEOUT, PRESENCE_GRACE_MS } from "../src/presence/grace.ts";
import { BACKENDS, T0 } from "./support/backends.ts";

/** A socket that records what the hub did to it. */
class FakeSocket implements HubSocket {
  readonly sent: string[] = [];
  readonly closes: { code: number; reason: string }[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  get lastFrame(): { t: string; s: number } {
    const raw = this.sent[this.sent.length - 1];
    if (raw === undefined) throw new Error("nothing was sent");
    return JSON.parse(raw) as { t: string; s: number };
  }
}

/** The hub's storage surface, in memory, with the alarm recorded rather than scheduled. */
class FakeHubStorage implements HubStorage {
  private readonly map = new Map<string, unknown>();
  alarmAtMs: number | null = null;
  alarmWrites = 0;

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async setAlarm(atMs: number): Promise<void> {
    this.alarmAtMs = atMs;
    this.alarmWrites += 1;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAtMs = null;
    this.alarmWrites += 1;
  }
}

/** A hub on one backend, with its clock and storage in hand. */
function hubFor(backend: (typeof BACKENDS)[number]) {
  const built = backend.make();
  const clock = built.clock as FixedClock;
  const storage = new FakeHubStorage();
  const published: AbsenceRecord[] = [];
  const hub = new PresenceHub({
    zoneId: "zone-1",
    coordinator: built.coordinator,
    storage,
    clock,
    onPublished: (record) => {
      published.push(record);
    },
  });
  return { hub, clock, storage, published, coordinator: built.coordinator };
}

for (const backend of BACKENDS) {
  describe(`presence hub/${backend.name}`, () => {
    test("a connect registers the device and arms the heartbeat deadline", async () => {
      const { hub, storage, clock } = hubFor(backend);
      const socket = new FakeSocket();
      const connected = await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      assert.equal(connected.session.actorId, "rider-a");
      assert.equal(connected.cancelled, false);
      assert.equal((await hub.present()).length, 1);
      assert.equal(storage.alarmAtMs, clock.nowMs() + 2_000);
    });

    test("a heartbeat is acknowledged with the sequence the client sent", async () => {
      const { hub, clock } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      clock.advance(750);
      const ack = await hub.beat(socket, 7);
      assert.equal(ack.known, true);
      assert.equal(ack.seq, 7);
      assert.equal(ack.stale, false);
      assert.equal(socket.lastFrame.t, "hb_ack");
      assert.equal(socket.lastFrame.s, 7);
      assert.equal(ack.deadlineMs, clock.nowMs() + 2_000);
    });

    test("a stale beat is acknowledged without moving the deadline", async () => {
      const { hub, clock } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      clock.advance(750);
      await hub.beat(socket, 5);
      const deadline = (await hub.beat(socket, 5)).deadlineMs;
      assert.equal(deadline, clock.nowMs() + 2_000);
      assert.equal((await hub.beat(socket, 4)).stale, true);
    });

    test("a beat from a socket the hub does not hold says so", async () => {
      const { hub } = hubFor(backend);
      const ack = await hub.beat(new FakeSocket(), 1);
      assert.equal(ack.known, false);
    });

    test("an involuntary close schedules the publication one grace later", async () => {
      const { hub, clock, storage } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "vendor-a", deviceId: "tablet", role: "PARTNER" });
      clock.advance(3_000);
      const scheduled = await hub.disconnect(socket, { code: 1_006, clean: false });
      assert.equal(scheduled.reason, "TRANSPORT_CLOSED");
      assert.equal(scheduled.publishAtMs, clock.nowMs() + PRESENCE_GRACE_MS);
      assert.equal(storage.alarmAtMs, scheduled.publishAtMs);
      assert.equal((await hub.alarm(clock.nowMs())).length, 0, "the grace is not over yet");
    });

    test("a deliberate close publishes at once", async () => {
      const { hub, clock, published } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      const scheduled = await hub.disconnect(socket, { code: CLOSE_GOING_OFFLINE, clean: true });
      assert.equal(scheduled.publishAtMs, clock.nowMs());
      assert.equal(scheduled.reason, "USER_OFFLINE");
      const publishedNow = await hub.alarm(clock.nowMs());
      assert.equal(publishedNow.length, 1);
      assert.equal(published[0]?.reason, "USER_OFFLINE");
      assert.equal((await hub.present()).length, 0);
    });

    test("a reconnect inside the grace cancels the publication", async () => {
      const { hub, clock, published } = hubFor(backend);
      const first = new FakeSocket();
      await hub.connect(first, { actorId: "vendor-a", deviceId: "tablet", role: "PARTNER" });
      await hub.disconnect(first, { code: 1_006, clean: false });
      clock.advance(200);
      const second = new FakeSocket();
      const reconnected = await hub.connect(second, { actorId: "vendor-a", deviceId: "tablet", role: "PARTNER" });
      assert.equal(reconnected.cancelled, true);
      assert.equal(hub.pendingAbsences().pending.length, 0);
      // The old publication instant passes with nothing pending, and the reconnected socket's own
      // deadline is still in the future, so the alarm publishes nothing.
      assert.equal((await hub.alarm(T0 + PRESENCE_GRACE_MS)).length, 0);
      assert.equal(published.length, 0);
    });

    test("a silence that outlives the deadline is absent, with no grace of its own", async () => {
      const { hub, clock, published } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      clock.advance(2_001);
      const absent = await hub.alarm(clock.nowMs());
      assert.equal(absent.length, 1);
      assert.equal(absent[0]?.reason, "HEARTBEAT_TIMEOUT");
      assert.deepEqual(socket.closes, [{ code: CLOSE_HEARTBEAT_TIMEOUT, reason: "heartbeat timeout" }]);
      assert.equal(published.length, 1);
      assert.equal((await hub.present()).length, 0);
    });

    test("answering keeps a device present past the deadline", async () => {
      const { hub, clock } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      for (let beat = 1; beat <= 6; beat += 1) {
        clock.advance(750);
        await hub.beat(socket, beat);
      }
      assert.equal((await hub.alarm(clock.nowMs())).length, 0);
      assert.equal((await hub.present()).length, 1);
    });

    test("a second alarm publishes nothing more", async () => {
      const { hub, clock, published } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      clock.advance(2_001);
      assert.equal((await hub.alarm(clock.nowMs())).length, 1);
      assert.equal((await hub.alarm(clock.nowMs())).length, 0);
      assert.equal(published.length, 1);
    });

    test("a device that never beat and a device that beat are swept together, once each", async () => {
      const { hub, clock } = hubFor(backend);
      const silent = new FakeSocket();
      const chatty = new FakeSocket();
      await hub.connect(silent, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      await hub.connect(chatty, { actorId: "rider-b", deviceId: "d2", role: "RIDER" });
      clock.advance(1_000);
      await hub.beat(chatty, 1);
      clock.advance(1_100);
      const absent = await hub.alarm(clock.nowMs());
      assert.deepEqual(absent.map((record) => record.actorId), ["rider-a"]);
      assert.equal((await hub.present()).length, 1);
    });

    test("the alarm is cleared when the room empties", async () => {
      const { hub, storage } = hubFor(backend);
      const socket = new FakeSocket();
      await hub.connect(socket, { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      await hub.disconnect(socket, { code: CLOSE_GOING_OFFLINE, clean: true });
      await hub.alarm(T0);
      assert.equal(storage.alarmAtMs, null);
      assert.equal(hub.socketCount(), 0);
    });

    test("a close for a socket the hub does not hold schedules nothing", async () => {
      const { hub, storage } = hubFor(backend);
      const scheduled = await hub.disconnect(new FakeSocket(), { code: 1_006, clean: false });
      assert.equal(scheduled.publishAtMs, T0);
      assert.equal(storage.alarmAtMs, null);
    });

    test("the ledger survives an eviction: a new hub publishes what the old one owed", async () => {
      const built = backend.make();
      const storage = new FakeHubStorage();
      const first = new PresenceHub({ zoneId: "zone-1", coordinator: built.coordinator, storage, clock: built.clock });
      const socket = new FakeSocket();
      await first.connect(socket, { actorId: "vendor-a", deviceId: "tablet", role: "PARTNER" });
      await first.disconnect(socket, { code: 1_006, clean: false });
      built.clock.advance(PRESENCE_GRACE_MS);
      const second = new PresenceHub({ zoneId: "zone-1", coordinator: built.coordinator, storage, clock: built.clock });
      const published = await second.alarm(built.clock.nowMs());
      assert.equal(published.length, 1);
      assert.equal(published[0]?.deviceId, "tablet");
    });
  });
}

/**
 * The offer as a deadline (`11 §7`, D132).
 *
 * Presence gives a room an alarm only while somebody is connected, which is the wrong shape for an offer: the zone that
 * needs a tick most is the one whose riders are all in their pockets. The room therefore holds a second kind of
 * deadline — the instants an announced wave asked for — and the assertions here are the three that keep the two kinds
 * from fighting: an earlier instant wins, a later one is ignored, and a fired instant is spent rather than repeated.
 */
for (const backend of BACKENDS) {
  describe(`dispatch deadlines in the room/${backend.name}`, () => {
    test("an armed instant moves the alarm ahead of every heartbeat", async () => {
      const { hub, storage, clock } = hubFor(backend);
      await hub.connect(new FakeSocket(), { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      assert.equal(storage.alarmAtMs, clock.nowMs() + 2_000);
      await hub.armDispatch([clock.nowMs() + 500]);
      assert.equal(storage.alarmAtMs, clock.nowMs() + 500, "the offer's instant is earlier than the beat's deadline");
    });

    test("an instant later than a presence deadline does not postpone it", async () => {
      const { hub, storage, clock } = hubFor(backend);
      await hub.connect(new FakeSocket(), { actorId: "rider-a", deviceId: "d1", role: "RIDER" });
      const heartbeatAt = storage.alarmAtMs;
      await hub.armDispatch([clock.nowMs() + 30_000]);
      assert.equal(storage.alarmAtMs, heartbeatAt, "a person's deadline is not moved by an offer's");
    });

    test("the fired instant is spent and the later one takes the alarm", async () => {
      const { hub, storage, clock } = hubFor(backend);
      const retryAt = clock.nowMs() + 3_000;
      const expiresAt = clock.nowMs() + 26_000;
      await hub.armDispatch([retryAt, expiresAt]);
      assert.equal(storage.alarmAtMs, retryAt);
      clock.advance(3_001);
      await hub.alarm();
      assert.deepEqual(hub.dispatchDeadlines(), [expiresAt], "the retry pass ran; the expiry is still owed");
      assert.equal(storage.alarmAtMs, expiresAt);
    });

    test("when the last instant is spent the alarm is cleared, so the room may be evicted", async () => {
      const { hub, storage, clock } = hubFor(backend);
      await hub.armDispatch([clock.nowMs() + 1_000]);
      clock.advance(1_001);
      await hub.alarm();
      assert.deepEqual(hub.dispatchDeadlines(), []);
      assert.equal(storage.alarmAtMs, null, "a room with nothing to wait for must not stay awake");
    });

    test("an instant in the past is dropped rather than scheduled", async () => {
      const { hub, storage, clock } = hubFor(backend);
      await hub.armDispatch([clock.nowMs() - 1, clock.nowMs() + 2_000]);
      assert.deepEqual(hub.dispatchDeadlines(), [clock.nowMs() + 2_000]);
      assert.equal(storage.alarmAtMs, clock.nowMs() + 2_000);
    });

    test("arming the same instant twice writes the alarm once", async () => {
      const { hub, storage, clock } = hubFor(backend);
      await hub.armDispatch([clock.nowMs() + 2_000]);
      const writes = storage.alarmWrites;
      await hub.armDispatch([clock.nowMs() + 2_000]);
      assert.equal(storage.alarmWrites, writes, "a wave every few seconds is not a storage write every few seconds");
    });
  });
}

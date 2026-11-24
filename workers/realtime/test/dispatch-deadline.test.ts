/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * When a zone room should wake for the wave it just announced (`11 §7`, D132).
 *
 * The arithmetic is the whole feature, so it is tested without a room, a socket or a clock: an offer's deadline becomes
 * two instants — a retry pass three seconds out, and the expiry a second past the offer's own — and anything that is
 * not an offer deadline produces nothing at all. The last case matters as much as the first: a room must not be kept
 * awake by an order state change that has nothing to expire.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  dispatchInstants,
  EXPIRE_SLACK_MS,
  MAX_WAKE_HORIZON_MS,
  RETRY_WAKE_MS,
} from "../src/hubs/dispatch-deadline.ts";

const T0 = 1_700_000_000_000;

describe("the instants a wave needs (D132)", () => {
  test("an offer's announcement is a retry pass and its expiry", () => {
    const expiresAtMs = T0 + 25_000;
    assert.deepEqual(dispatchInstants({ expiresAtMs }, T0), [
      T0 + RETRY_WAKE_MS,
      expiresAtMs + EXPIRE_SLACK_MS,
    ]);
  });

  test("an announcement that carries no offer deadline arms nothing", () => {
    assert.deepEqual(dispatchInstants({ state: "RIDER_ASSIGNED" }, T0), []);
    assert.deepEqual(dispatchInstants({}, T0), []);
    assert.deepEqual(dispatchInstants(null, T0), []);
    assert.deepEqual(dispatchInstants("expiresAtMs", T0), []);
    assert.deepEqual(dispatchInstants({ expiresAtMs: "25000" }, T0), []);
  });

  test("an expiry too far ahead is a bad clock, not an offer", () => {
    assert.deepEqual(dispatchInstants({ expiresAtMs: T0 + MAX_WAKE_HORIZON_MS + 1 }, T0), []);
  });

  test("an expiry already past is a wake that has already missed", () => {
    assert.deepEqual(dispatchInstants({ expiresAtMs: T0 - 1 }, T0), []);
    assert.deepEqual(dispatchInstants({ expiresAtMs: T0 }, T0), []);
  });

  test("a wave announced inside its own retry window only needs the expiry", () => {
    // A re-send of a wave that has 2 s left: a retry instant two seconds from now would be past the deadline.
    const expiresAtMs = T0 + 2_000;
    assert.deepEqual(dispatchInstants({ expiresAtMs }, T0), [expiresAtMs + EXPIRE_SLACK_MS]);
  });

  test("the instants are ordered, so the room can take the first", () => {
    const instants = dispatchInstants({ expiresAtMs: T0 + 25_000 }, T0);
    assert.deepEqual([...instants].sort((left, right) => left - right), instants);
  });
});

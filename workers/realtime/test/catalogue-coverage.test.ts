/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Every transition the order machine can make is a frame the stream can carry (`08 §9.1`, D105).
 *
 * The two halves of the platform name events independently: `undal-core`'s transition table writes the name
 * into the log and hands it to `announce`, and this Worker refuses a name its catalogue does not carry
 * (`catalogueName` returns null, the internal route answers `unknown_event`, and `announce` treats that as a
 * degraded notification and moves on). A drift between the two is therefore silent in production and total:
 * the transition happens, the frame is refused, nobody watching hears about it.
 *
 * This test is the one place the two lists are compared. It imports the transition table rather than a copy of
 * it, so a row added to the machine is checked the moment it exists.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TRANSITIONS } from "../../core/src/domain/order/state-machine.ts";
import { EVENT_NAMES, catalogueName } from "../src/sse/hub.ts";

describe("the catalogue covers the state machine", () => {
  test("every transition's event name is one the stream carries", () => {
    const missing = TRANSITIONS.map((transition) => transition.event)
      .filter((event, index, all) => all.indexOf(event) === index)
      .filter((event) => catalogueName(event) === null);
    assert.deepEqual(missing, [], `the stream would refuse these and nobody would hear the transition`);
  });

  test("the three names that had drifted are the catalogue's, not the machine's invention", () => {
    // `order.rider_assigned` / `order.rider_search` / `order.auto_cancelled` were the machine's own spellings.
    // The catalogue (`08 §9.1`, which the apps are generated from) has these.
    assert.equal(catalogueName("order.assigned"), "order.assigned");
    assert.equal(catalogueName("order.searching"), "order.searching");
    assert.equal(catalogueName("order.cancelled"), "order.cancelled");
  });

  test("the stored kinds still map, because the log holds state names rather than catalogue names", () => {
    assert.equal(catalogueName("RIDER_ASSIGNED"), "order.assigned");
    assert.equal(catalogueName("AUTO_CANCELLED"), "order.cancelled");
    assert.equal(EVENT_NAMES["RIDER_ASSIGNED"], "order.assigned");
  });

  test("the offer alarm's event is the catalogue's `offer.new`, not the `order.offer` D127 invented", () => {
    // The gate is a map, so a misspelt event is not an error anybody sees: the internal route answers `unknown_event`
    // and `announce` treats that as a degraded notification. D127's alarm therefore reached no socket at all (D132).
    assert.equal(catalogueName("offer.new"), "offer.new");
    assert.equal(catalogueName("order.offer"), null);
  });
});

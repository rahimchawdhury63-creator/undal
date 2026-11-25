/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useCounts } from "../src/lib/counts.ts";

describe("queue counts in navigation", () => {
  it("start absent rather than zero, because an unverified zero is a claim", () => {
    assert.equal(useCounts.getState().settlementsWaiting, null);
    assert.equal(useCounts.getState().declarationsOpen, null);
  });

  it("publishes what a page learned", () => {
    useCounts.getState().publish(7, 2);
    assert.equal(useCounts.getState().settlementsWaiting, 7);
    assert.equal(useCounts.getState().declarationsOpen, 2);
  });

  it("publishes one half without erasing the other", () => {
    useCounts.getState().publish(7, 2);
    useCounts.getState().publish(9, null);
    assert.equal(useCounts.getState().settlementsWaiting, 9);
    assert.equal(useCounts.getState().declarationsOpen, null);
  });
});

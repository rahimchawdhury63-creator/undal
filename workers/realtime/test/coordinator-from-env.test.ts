/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Which coordinator an environment describes, and why it refuses when it describes none (D90).
 *
 * The free path used to be unbuildable: the mode was `sql`, the store was a test double and the executor did
 * not exist, so every unconfigured deployment answered `coordinator_not_configured`. Now the mode builds when
 * its two dependencies are present, and still refuses — by name — when one is missing. A fallback to the
 * other backend would be worse than a refusal: one is a bill, the other is capacity nobody is using.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRESENCE_STALENESS_MS } from "../src/coordination/coordinator.ts";
import { coordinatorFrom } from "../src/coordination/from-env.ts";

const room = {} as DurableObjectNamespace;

describe("the free path", () => {
  test("builds when core is addressable and the token is present", () => {
    const result = coordinatorFrom({
      COORDINATION_MODE: "sql",
      CORE_BASE_URL: "https://api.undal.app",
      INTERNAL_TOKEN: "internal-secret",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mode, "sql");
    // The stamped window is the TiDB coordinator's; the Durable Object's is the two-second deadline.
    assert.equal(result.coordinator.presenceWindowMs, PRESENCE_STALENESS_MS);
  });

  test("an unset mode is the free path, so a blank deployment is not a paid one", () => {
    const result = coordinatorFrom({
      CORE_BASE_URL: "https://api.undal.app",
      INTERNAL_TOKEN: "internal-secret",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.mode, "sql");
  });

  test("a missing token is named, not guessed at", () => {
    const result = coordinatorFrom({ COORDINATION_MODE: "sql", CORE_BASE_URL: "https://api.undal.app" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.reason, "coordinator_not_configured");
    assert.match(result.error.detail, /INTERNAL_TOKEN/u);
    assert.equal(result.error.mode, "sql");
  });

  test("a missing address and a missing token are both named", () => {
    const result = coordinatorFrom({ COORDINATION_MODE: "sql" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error.detail, /CORE_BASE_URL and INTERNAL_TOKEN/u);
  });
});

describe("the paid path", () => {
  test("builds when the room binding exists", () => {
    const result = coordinatorFrom({ COORDINATION_MODE: "durable-object", COORDINATION_ROOM: room });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mode, "durable-object");
      assert.equal(result.coordinator.presenceWindowMs, 2_000);
    }
  });

  test("refuses by name when the binding is missing", () => {
    const result = coordinatorFrom({ COORDINATION_MODE: "durable-object" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error.detail, /COORDINATION_ROOM/u);
  });

  test("a mode the Worker does not know is a misconfiguration, not a default", () => {
    const result = coordinatorFrom({ COORDINATION_MODE: "dynamo", CORE_BASE_URL: "x", INTERNAL_TOKEN: "y" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.reason, "misconfigured");
  });
});

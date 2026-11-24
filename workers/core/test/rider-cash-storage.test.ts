/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cashCollectedPaisa, cashOutstandingPaisa } from "../src/repositories/riders.ts";
import { stubDb } from "../src/db/client.ts";

const RIDER_ID = new Uint8Array(16).fill(7);

function balanceDb(column: "outstanding_paisa" | "collected_paisa", value: unknown) {
  return stubDb([
    {
      match:
        column === "outstanding_paisa"
          ? /SELECT `outstanding_paisa`/u
          : /SELECT `collected_paisa`/u,
      rows: [{ [column]: value }],
    },
  ]);
}

test("cash balance reads accept exact integers and treat a missing row as zero", async () => {
  for (const value of [0, "0", "214000", "214000.00"]) {
    const outstanding = balanceDb("outstanding_paisa", value);
    const collected = balanceDb("collected_paisa", value);
    assert.equal(
      await cashOutstandingPaisa(outstanding, RIDER_ID),
      value === 0 || value === "0" ? 0 : 214000,
    );
    assert.equal(
      await cashCollectedPaisa(collected, RIDER_ID),
      value === 0 || value === "0" ? 0 : 214000,
    );
    assert.deepEqual(outstanding.calls[0]!.params, [RIDER_ID]);
    assert.deepEqual(collected.calls[0]!.params, [RIDER_ID]);
  }

  const missing = stubDb([{ match: /FROM `rider_cash_balances`/u, rows: [] }]);
  assert.equal(await cashOutstandingPaisa(missing, RIDER_ID), 0);
  assert.equal(await cashCollectedPaisa(missing, RIDER_ID), 0);
  assert.equal(missing.calls.length, 2);
});

test("cash balance reads fail closed on null, negative, fractional or unsafe database integers", async () => {
  const invalidValues: unknown[] = [
    null,
    undefined,
    -1,
    "-1",
    1.5,
    "214000.01",
    "1e3",
    "9007199254740992",
    "-9007199254740992",
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    {},
  ];
  for (const value of invalidValues) {
    const outstanding = balanceDb("outstanding_paisa", value);
    const collected = balanceDb("collected_paisa", value);
    await assert.rejects(cashOutstandingPaisa(outstanding, RIDER_ID), RangeError, String(value));
    await assert.rejects(cashCollectedPaisa(collected, RIDER_ID), RangeError, String(value));
  }
});

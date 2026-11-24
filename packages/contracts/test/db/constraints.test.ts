/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONSTRAINTS, constraintsFor, validateRow } from "../../src/constraints/index.ts";
import registry from "../../src/constraints.json" with { type: "json" };

/**
 * A delivered order that satisfies every declared rule, used as the base for the
 * negative cases. Every column any constraint on `orders` mentions is present:
 * a partial row is not what the database would hand back, and validating one
 * would only prove that `undefined >= 0` is false.
 */
function deliveredOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fulfilment: "DELIVERY",
    state: "DELIVERED",
    payment_method: "COD",
    prep_time_source: null,
    subtotal_paisa: 45_000,
    discount_paisa: 0,
    delivery_fee_paisa: 7_042,
    small_order_fee_paisa: 2_500,
    tax_paisa: 439,
    tip_paisa: 0,
    rounding_paisa: -81,
    total_paisa: 54_900,
    fare_source: "BRAIN",
    distance_source: "OSRM",
    delivery_lat_e7: 248_949_000,
    delivery_lon_e7: 918_687_000,
    ...overrides,
  };
}

describe("declared CHECK constraints, enforced in code", () => {
  test("the registry and the generated validators are the same list", () => {
    const registered = new Set(registry.constraints.map((entry) => entry.name));
    const generated = new Set(Object.values(CONSTRAINTS).flat().map((entry) => entry.name));
    assert.deepEqual([...generated].sort(), [...registered].sort());
    assert.equal(registry.count, registered.size);
  });

  test("every generated constraint carries the SQL it came from", () => {
    for (const [table, items] of Object.entries(CONSTRAINTS)) {
      for (const item of items) {
        assert.equal(item.table, table);
        assert.ok(item.sql.length > 0, `${item.name} has no SQL`);
        assert.match(item.sql, /^[A-Za-z(`].*/, `${item.name} SQL looks wrong`);
      }
    }
  });

  test("a valid order passes every rule", () => {
    assert.deepEqual(validateRow("orders", deliveredOrder()), []);
  });

  test("a total that is not whole taka is refused — the money law's last step", () => {
    const violations = validateRow("orders", deliveredOrder({ total_paisa: 54_981 }));
    assert.ok(violations.some((violation) => violation.constraint === "chk_orders_total_whole_taka"));
  });

  test("a rounding delta outside 99 paisa is refused", () => {
    const violations = validateRow("orders", deliveredOrder({ rounding_paisa: -500 }));
    assert.ok(violations.some((violation) => violation.constraint === "chk_orders_rounding_bounded"));
  });

  test("a total below subtotal minus discount is refused", () => {
    const violations = validateRow("orders", deliveredOrder({ total_paisa: 0, subtotal_paisa: 45_000 }));
    assert.ok(violations.some((violation) => violation.constraint === "chk_orders_total_covers_subtotal"));
  });

  test("a delivery with no destination point is refused", () => {
    const violations = validateRow("orders", deliveredOrder({ delivery_lat_e7: null }));
    assert.ok(violations.some((violation) => violation.constraint === "chk_orders_delivery_has_point"));
  });

  test("an order line whose total contradicts its quantity is refused", () => {
    const violations = validateRow("order_items", {
      unit_price_paisa: 12_000,
      quantity: 2,
      line_total_paisa: 23_000,
    });
    assert.ok(violations.some((violation) => violation.constraint === "chk_order_items_line_total"));
  });

  test("a zero posting is refused: the ledger has no empty entries", () => {
    const violations = validateRow("ledger_postings", { amount_paisa: 0 });
    assert.ok(violations.some((violation) => violation.constraint === "chk_ledger_postings_nonzero"));
  });

  test("a fee can only be a tip when it has no rate", () => {
    const withRate = validateRow("order_fees", { kind: "TIP", amount_paisa: 1_000, rate_bps: 800 });
    const withoutRate = validateRow("order_fees", { kind: "TIP", amount_paisa: 1_000, rate_bps: null });
    assert.equal(withRate.length > 0, true);
    assert.equal(withoutRate.length, 0);
  });

  test("a table with no declared rule is not rejected", () => {
    assert.deepEqual(validateRow("no_such_table", {}), []);
    assert.deepEqual(constraintsFor("no_such_table"), []);
  });
});

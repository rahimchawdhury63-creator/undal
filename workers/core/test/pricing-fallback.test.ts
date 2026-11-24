/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { fail, ok } from "../src/lib/result.ts";
import type { BrainClient } from "../src/bindings/brain.ts";
import { LAUNCH_RATES, priceOrder, type FareInput, type WeatherCondition } from "../src/pricing/fallback.ts";
import { resolveFare, type FareContext } from "../src/pricing/resolve.ts";

/**
 * The fallback is the Brain's twin, and the forty vectors are the proof.
 *
 * These are the same forty cases the Python engine is tested against (`workers/brain/test/`), read
 * from the same file. If the two implementations ever disagree by a paisa — a rounding change, a
 * band moved, a clamp tightened — this test fails in TypeScript on the next commit instead of the
 * platform charging one price online and another during a deploy.
 */

interface Vector {
  readonly id: string;
  readonly input: {
    readonly vehicle: "MOTORBIKE" | "BICYCLE";
    readonly routed_distance_m: number;
    readonly traffic_delay_s: number;
    readonly riders: number;
    readonly orders: number;
    readonly weather: WeatherCondition;
    readonly weather_confidence: number;
    readonly item_subtotal_paisa: number;
    readonly tip_paisa: number;
    readonly fulfilment: "DELIVERY" | "PICKUP";
    readonly batch_position: number;
    readonly batch_marginal_distance_m: number;
  };
  readonly surge_bps: number;
  readonly expected: Readonly<Record<string, unknown>>;
}

const VECTORS: readonly Vector[] = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../../brain/test/vectors/fare_vectors.json", import.meta.url)), "utf8")) as {
    vectors: Vector[];
  }
).vectors;

function inputFor(vector: Vector): FareInput {
  const raw = vector.input;
  return {
    rates: LAUNCH_RATES[raw.vehicle],
    fulfilment: raw.fulfilment,
    // The vector's published multiplier, taken as an input: the curve that produces it is the
    // Brain's alone (`workers/brain/src/fare/surge.py` and `test_surge_curve.py`).
    surgeBps: vector.surge_bps,
    routedDistanceM: raw.routed_distance_m,
    trafficDelayS: raw.traffic_delay_s,
    weather: raw.weather,
    weatherConfidenceBps: Math.round(raw.weather_confidence * 10_000),
    itemSubtotalPaisa: raw.item_subtotal_paisa,
    tipPaisa: raw.tip_paisa,
    batchPosition: raw.batch_position,
    batchMarginalDistanceM: raw.batch_marginal_distance_m,
  };
}

/** Flatten the Python dataclass the vector stores, so each field is compared by name. */
function flat(expected: Readonly<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (prefix: string, node: unknown): void => {
    if (typeof node === "number") {
      out[prefix] = node;
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) walk(prefix === "" ? key : `${prefix}.${key}`, value);
  };
  walk("", expected);
  return out;
}

function actualFor(vector: Vector): Record<string, number> {
  const breakdown = priceOrder(inputFor(vector));
  return {
    surge_bps: breakdown.surgeBps,
    "core.surged_base_paisa": breakdown.core.surgedBasePaisa,
    "core.distance_paisa": breakdown.core.distancePaisa,
    "core.traffic_paisa": breakdown.core.trafficPaisa,
    "core.total_paisa": breakdown.core.totalPaisa,
    delivery_fee_paisa: breakdown.deliveryFeePaisa,
    delivery_margin_paisa: breakdown.deliveryMarginPaisa,
    "small_order.total_paisa": breakdown.smallOrderTotalPaisa,
    "small_order.rider_paisa": breakdown.smallOrderRiderPaisa,
    "small_order.vendor_paisa": breakdown.smallOrderVendorPaisa,
    "small_order.platform_paisa": breakdown.smallOrderPlatformPaisa,
    commission_paisa: breakdown.commissionPaisa,
    rider_bonus_paisa: breakdown.riderBonusPaisa,
    taxable_base_paisa: breakdown.taxableBasePaisa,
    tax_paisa: breakdown.taxPaisa,
    weather_paisa: breakdown.weatherPaisa,
    bundle_paisa: breakdown.bundlePaisa,
    tip_paisa: breakdown.tipPaisa,
    customer_total_paisa: breakdown.customerTotalPaisa,
    rounding_delta_paisa: breakdown.roundingDeltaPaisa,
    vendor_payout_paisa: breakdown.vendorPayoutPaisa,
    rider_payout_paisa: breakdown.riderPayoutPaisa,
    platform_commission_paisa: breakdown.platformCommissionPaisa,
    platform_small_order_paisa: breakdown.platformSmallOrderPaisa,
    platform_delivery_net_paisa: breakdown.platformDeliveryNetPaisa,
    platform_weather_expense_paisa: breakdown.platformWeatherExpensePaisa,
    platform_tax_payable_paisa: breakdown.platformTaxPayablePaisa,
    platform_rounding_expense_paisa: breakdown.platformRoundingExpensePaisa,
  };
}

describe("the deterministic engine against the Brain's vectors", () => {
  test("all forty vectors agree, field for field", () => {
    assert.equal(VECTORS.length, 40);
    for (const vector of VECTORS) {
      const expected = flat(vector.expected);
      const actual = actualFor(vector);
      for (const [field, value] of Object.entries(expected)) {
        assert.equal(actual[field], value, `vector ${vector.id}, ${field}`);
      }
      assert.equal(actual["surge_bps"], vector.surge_bps, `vector ${vector.id}, surge`);
    }
  });

  test("the demonstration fare is the documented one", () => {
    const vector = VECTORS[0];
    assert.ok(vector !== undefined);
    const breakdown = priceOrder(inputFor(vector));
    assert.equal(breakdown.core.totalPaisa, 6_520);
    assert.equal(breakdown.deliveryFeePaisa, 7_042);
    assert.equal(breakdown.customerTotalPaisa, 54_900);
    assert.equal(breakdown.roundingDeltaPaisa, -81);
  });

  test("a multiplier that is not a published band value is refused", () => {
    const vector = VECTORS[0];
    assert.ok(vector !== undefined);
    for (const surgeBps of [9_999, 22_001, 10_500.5, 12_000.25]) {
      assert.throws(() => priceOrder({ ...inputFor(vector), surgeBps }), /not a published multiplier/);
    }
  });

  test("an input that would price a coordinate bug is refused", () => {
    const vector = VECTORS[0];
    assert.ok(vector !== undefined);
    assert.throws(() => priceOrder({ ...inputFor(vector), routedDistanceM: 250_000 }), /twice the vehicle radius/);
  });
});

const CONTEXT: FareContext = { zoneId: "z1", vendorId: "v1", atIso: "2026-11-02T10:00:00.000Z", itemsCount: 3 };

function brainAnswering(answer: Awaited<ReturnType<BrainClient["quote"]>>): BrainClient {
  return { quote: () => Promise.resolve(answer) };
}

describe("which engine priced the order", () => {
  const vector = VECTORS[0];
  const input = vector === undefined ? null : inputFor(vector);

  test("no Brain configured is a fallback, and the price is still exact", async () => {
    assert.ok(input !== null);
    const resolved = await resolveFare(null, input, CONTEXT);
    assert.equal(resolved.source, "FALLBACK");
    assert.equal(resolved.degraded, "NO_CLIENT");
    assert.equal(resolved.breakdown.customerTotalPaisa, 54_900);
  });

  test("an agreeing Brain earns the provenance", async () => {
    assert.ok(input !== null);
    const resolved = await resolveFare(
      brainAnswering(ok({ deliveryFeePaisa: 7_042, rideCorePaisa: 6_520, surgeBps: 10_000, riderPayoutPaisa: 8_370, source: "BRAIN", explanation: ["base fare ৳40.00"] })),
      input,
      CONTEXT,
    );
    assert.equal(resolved.source, "BRAIN");
    assert.equal(resolved.degraded, null);
    assert.deepEqual(resolved.explanation, ["base fare ৳40.00"]);
  });

  test("a Brain that disagrees by one paisa does not move the price", async () => {
    assert.ok(input !== null);
    const resolved = await resolveFare(
      brainAnswering(ok({ deliveryFeePaisa: 7_043, rideCorePaisa: 6_520, surgeBps: 10_000, riderPayoutPaisa: 8_370, source: "BRAIN", explanation: [] })),
      input,
      CONTEXT,
    );
    assert.equal(resolved.source, "FALLBACK");
    assert.equal(resolved.degraded, "BRAIN_DISAGREES");
    assert.deepEqual(resolved.disagreements, [{ field: "deliveryFeePaisa", brain: 7_043, deterministic: 7_042 }]);
    assert.equal(resolved.breakdown.customerTotalPaisa, 54_900);
  });

  test("a Brain that declines, or answers with nonsense, is a fallback either way", async () => {
    assert.ok(input !== null);
    const unavailable = await resolveFare(brainAnswering(fail("DEPENDENCY_TIMEOUT", { details: {} })), input, CONTEXT);
    assert.equal(unavailable.degraded, "BRAIN_UNAVAILABLE");

    const malformed = await resolveFare(
      brainAnswering(ok({ deliveryFeePaisa: 7_042.5, rideCorePaisa: 6_520, surgeBps: 10_000, riderPayoutPaisa: 8_370, source: "BRAIN", explanation: [] })),
      input,
      CONTEXT,
    );
    assert.equal(malformed.degraded, "BRAIN_MALFORMED");
  });

  test("a Brain that says it is the fallback is not trusted as the Brain", async () => {
    assert.ok(input !== null);
    const resolved = await resolveFare(
      brainAnswering(ok({ deliveryFeePaisa: 7_042, rideCorePaisa: 6_520, surgeBps: 10_000, riderPayoutPaisa: 8_370, source: "FALLBACK", explanation: [] })),
      input,
      CONTEXT,
    );
    assert.equal(resolved.source, "FALLBACK");
  });
});

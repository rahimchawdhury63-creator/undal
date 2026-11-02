/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ADDRESS_SNAPSHOT_VERSION, SnapshotRefused, readAddressSnapshot, riderView, snapshotAddress } from "../src/domain/order/snapshots.ts";
import { ProofRefused, admissibleProof, hasDeliveryEvidence, hasPickupEvidence, type ProofCapture } from "../src/domain/order/evidence.ts";
import { explainFare } from "../src/domain/order/explain.ts";
import { LAUNCH_RATES, priceOrder } from "../src/pricing/fallback.ts";

/**
 * Frozen addresses, admissible evidence, and fee explanations.
 *
 * The three share a property: each makes a past moment checkable. An address snapshot says what the
 * door was called when the order was placed, a proof says somebody was standing at it, and an
 * explanation says why the charge was what it was. All three are refusals as much as records, so the
 * tests are mostly about what is *not* accepted.
 */

const DOOR = { latE7: 248_981_000, lonE7: 918_712_000 };

const ADDRESS = {
  addressId: "0193f2a1-7c3e-7890-abcd-ef0123456705",
  label: "Home",
  recipientName: "Rahim",
  phone: "+8801712345678",
  line1: "House 12, Road 3",
  line2: "Block C",
  landmark: "Beside the mosque",
  latE7: DOOR.latE7,
  lonE7: DOOR.lonE7,
  city: "Sylhet",
  zoneId: "0193f2a1-7c3e-7890-abcd-ef0123456703",
};

describe("an address snapshot", () => {
  test("is a frozen copy with a version and the moment it was taken", () => {
    const snapshot = snapshotAddress(ADDRESS, 1_000);
    assert.equal(snapshot.version, ADDRESS_SNAPSHOT_VERSION);
    assert.equal(snapshot.line1, "House 12, Road 3");
    assert.equal(snapshot.frozenAtIso, new Date(1_000).toISOString());
    assert.equal(snapshot.landmark, "Beside the mosque");
  });

  test("a rename next month cannot change it, because it is a copy and not a reference", () => {
    const original = { ...ADDRESS };
    const snapshot = snapshotAddress(original, 1_000);
    original.line1 = "Somewhere else";
    assert.equal(snapshot.line1, "House 12, Road 3");
  });

  test("an address without a first line or a dialable phone is refused", () => {
    assert.throws(() => snapshotAddress({ ...ADDRESS, line1: "  " }, 0), SnapshotRefused);
    assert.throws(() => snapshotAddress({ ...ADDRESS, phone: "123" }, 0), { code: "VALIDATION_FAILED" });
  });

  test("a snapshot from a version this build does not know is not read", () => {
    const snapshot = snapshotAddress(ADDRESS, 1_000);
    assert.deepEqual(readAddressSnapshot(snapshot), snapshot);
    assert.equal(readAddressSnapshot({ ...snapshot, version: 99 }), null);
    assert.equal(readAddressSnapshot("Home"), null);
  });

  test("the rider sees the door and the phone, and nothing else is implied", () => {
    const view = riderView(snapshotAddress(ADDRESS, 1_000));
    assert.equal(view.phone, "+8801712345678");
    assert.equal("recipientName" in view, false, "a name on the door is the customer's to give, not the platform's to print");
  });
});

const CAPTURE: ProofCapture = {
  kind: "DELIVERY_PHOTO",
  orderId: "0193f2a1-7c3e-7890-abcd-ef0123456709",
  mediaId: "0193f2a1-7c3e-7890-abcd-ef012345670a",
  payload: null,
  point: DOOR,
  capturedAtMs: 1_000_000,
};

describe("admissible evidence", () => {
  const expectation = { point: DOOR, nowMs: 1_000_000 + 60_000 };

  test("a photograph at the door, a minute old, is admissible", () => {
    assert.doesNotThrow(() => admissibleProof(CAPTURE, expectation));
  });

  test("a photograph with no media is a client bug, not evidence", () => {
    assert.throws(() => admissibleProof({ ...CAPTURE, mediaId: null }, expectation), { code: "ORDER_PROOF_MISSING_MEDIA" });
  });

  test("a scanned code carries its payload, and is held to the same geofence", () => {
    const scan: ProofCapture = { ...CAPTURE, kind: "PICKUP_QR", mediaId: null, payload: { code: "UND-7K2M9QX4" } };
    assert.doesNotThrow(() => admissibleProof(scan, expectation));
    assert.throws(() => admissibleProof({ ...scan, payload: null }, expectation), { code: "ORDER_PROOF_INVALID_PAYLOAD" });
    // 0.004° of latitude is about 440 m, well outside the 150 m geofence.
    assert.throws(() => admissibleProof({ ...scan, point: { latE7: DOOR.latE7 + 40_000, lonE7: DOOR.lonE7 } }, expectation), {
      code: "ORDER_PROOF_TOO_FAR",
    });
  });

  test("a capture from an hour ago is somebody else's delivery", () => {
    assert.throws(() => admissibleProof(CAPTURE, { ...expectation, nowMs: 1_000_000 + 3_600_000 }), { code: "ORDER_PROOF_STALE" });
  });

  test("a capture dated in the future is a clock bug, refused rather than believed", () => {
    assert.throws(() => admissibleProof(CAPTURE, { ...expectation, nowMs: 999_000 }), { code: "ORDER_PROOF_STALE" });
  });

  test("a capture with no position cannot prove where it was taken", () => {
    assert.throws(() => admissibleProof({ ...CAPTURE, point: null }, expectation), { code: "ORDER_PROOF_TOO_FAR" });
  });

  test("a delivery needs a door-side proof; a pickup needs the scan", () => {
    const scan: ProofCapture = { ...CAPTURE, kind: "PICKUP_QR", mediaId: null, payload: { code: "x" } };
    const signature: ProofCapture = { ...CAPTURE, kind: "CUSTOMER_SIGNATURE" };
    assert.equal(hasDeliveryEvidence([scan]), false, "a pickup code says nothing about the doorstep");
    assert.equal(hasPickupEvidence([signature]), false);
    assert.equal(hasDeliveryEvidence([signature]), true);
    assert.equal(hasPickupEvidence([scan]), true);
  });
});

describe("explaining a fare", () => {
  const breakdown = priceOrder({
    rates: LAUNCH_RATES.MOTORBIKE,
    fulfilment: "DELIVERY",
    surgeBps: 10_000,
    routedDistanceM: 3_800,
    trafficDelayS: 0,
    weather: "CLEAR",
    weatherConfidenceBps: 9_500,
    itemSubtotalPaisa: 45_000,
    tipPaisa: 0,
  });
  const input = { breakdown, distanceM: 3_800, baseDistanceM: 2_000, perKmPaisa: 1_400, weather: "CLEAR", trafficDelayS: 0 };

  test("the lines quote the numbers the customer was charged", () => {
    const lines = explainFare(input);
    const base = lines.find((line) => line.key === "base");
    assert.equal(base?.textEn, "Base fare ৳\u200940.00");
    const distance = lines.find((line) => line.key === "distance_charge");
    assert.match(distance?.textEn ?? "", /৳\u200925\.20/u);
    assert.match(lines.find((line) => line.key === "distance")?.textEn ?? "", /3\.8 km travelled/u);
  });

  test("the multiplier is always shown, even at 1.00×", () => {
    const surge = explainFare(input).find((line) => line.key === "surge");
    assert.equal(surge?.textEn, "Multiplier 1.00× — not busy");
    assert.match(surge?.textBn ?? "", /গুণক/u);
  });

  test("a zero line is dropped, and a real one is not", () => {
    const keys = explainFare(input).map((line) => line.key);
    assert.equal(keys.includes("traffic"), false);
    assert.equal(keys.includes("weather"), false);
    assert.equal(keys.includes("small_order"), true, "a ৳25 order fee is on this receipt and must be explained");
    assert.equal(keys.includes("rounding"), true);
  });

  test("traffic is explained in the blocks it is charged in", () => {
    const busy = priceOrder({
      rates: LAUNCH_RATES.MOTORBIKE,
      fulfilment: "DELIVERY",
      surgeBps: 10_000,
      routedDistanceM: 3_800,
      trafficDelayS: 700,
      weather: "CLEAR",
      weatherConfidenceBps: 9_500,
      itemSubtotalPaisa: 45_000,
      tipPaisa: 0,
    });
    const lines = explainFare({ ...input, breakdown: busy, trafficDelayS: 700 });
    assert.match(lines.find((line) => line.key === "traffic")?.textEn ?? "", /2 five-minute block/u);
  });
});

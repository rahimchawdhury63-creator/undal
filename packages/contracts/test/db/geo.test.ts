/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bboxOf, haversineMeters, inBbox, pointInRing, type PointE7 } from "../../src/db/geo.ts";

const SYLHET: PointE7 = { latE7: 248_949_000, lonE7: 918_687_000 };
const DHAKA: PointE7 = { latE7: 238_104_000, lonE7: 908_414_000 };

/** A 1 km square around Sylhet, in storage coordinates. */
const SQUARE: PointE7[] = [
  { latE7: 248_940_000, lonE7: 918_680_000 },
  { latE7: 248_940_000, lonE7: 918_700_000 },
  { latE7: 248_960_000, lonE7: 918_700_000 },
  { latE7: 248_960_000, lonE7: 918_680_000 },
];

describe("integer geometry", () => {
  test("haversine returns whole metres and is symmetric", () => {
    const forward = haversineMeters(SYLHET, DHAKA);
    const backward = haversineMeters(DHAKA, SYLHET);
    assert.equal(Number.isInteger(forward), true);
    assert.equal(forward, backward);
    // Great-circle Sylhet to Dhaka is about 159 km; the road is 200 km and the
    // bug this catches is a haversine that mistook degrees for radians.
    assert.ok(forward > 150_000 && forward < 170_000, `got ${forward} m`);
  });

  test("distance to itself is exactly zero", () => {
    assert.equal(haversineMeters(SYLHET, SYLHET), 0);
  });

  test("a point inside the ring is inside", () => {
    assert.equal(pointInRing(SYLHET, SQUARE), true);
  });

  test("a point outside the ring is outside", () => {
    assert.equal(pointInRing({ latE7: 249_000_000, lonE7: 918_700_000 }, SQUARE), false);
    assert.equal(pointInRing({ latE7: 248_940_001, lonE7: 918_679_000 }, SQUARE), false);
  });

  test("a point exactly on a vertex or an edge counts as inside", () => {
    assert.equal(pointInRing(SQUARE[0]!, SQUARE), true);
    assert.equal(pointInRing({ latE7: 248_950_000, lonE7: 918_680_000 }, SQUARE), true);
    assert.equal(pointInRing({ latE7: 248_940_000, lonE7: 918_690_000 }, SQUARE), true);
  });

  test("the bounding box rejects quickly and agrees with the ring", () => {
    const box = bboxOf(SQUARE);
    assert.deepEqual(box, {
      minLatE7: 248_940_000,
      minLonE7: 918_680_000,
      maxLatE7: 248_960_000,
      maxLonE7: 918_700_000,
    });
    assert.equal(inBbox(SYLHET, box), true);
    assert.equal(inBbox({ latE7: 300_000_000, lonE7: 918_690_000 }, box), false);
  });

  test("a ring with fewer than three corners is refused", () => {
    assert.throws(() => bboxOf([SYLHET, DHAKA]), RangeError);
    assert.throws(() => pointInRing(SYLHET, [SYLHET, DHAKA]), RangeError);
  });
});

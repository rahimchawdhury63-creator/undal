/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Where a zone ends (`11 §7` filter 7, D119).
 *
 * The predicate that decides whether a rider is inside their own zone is the kind that is right for every point
 * except the ones users stand on, so the tests include the edges, the vertices and the corner cases rather than
 * only the middle of the polygon. The distances are checked against known geography: one thousandth of a degree of
 * latitude at Sylhet's latitude is 111.19 m, and the assertions use that rather than a number the implementation
 * produced.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { haversineMeters } from "@undal/contracts";
import {
  MAX_PLANAR_RING_M,
  distanceOutsideZoneM,
  insideZone,
  parseZoneRing,
  ringExtentM,
} from "../src/domain/geo/zone-shape.ts";

/** Sylhet, roughly. Everything below is expressed as offsets from here in E7. */
const LAT0 = 248_981_000;
const LON0 = 918_698_000;

/** One thousandth of a degree of latitude, in E7. Mercifully, exactly 10 000. */
const STEP = 10_000;

/** A 1 km-ish square: ±0.0045° lat and ±0.0049° lon around the origin. */
function squareRing(): unknown {
  const dLat = 45 * STEP;
  const dLon = 49 * STEP;
  return [
    [LON0 - dLon, LAT0 - dLat],
    [LON0 + dLon, LAT0 - dLat],
    [LON0 + dLon, LAT0 + dLat],
    [LON0 - dLon, LAT0 + dLat],
    [LON0 - dLon, LAT0 - dLat],
  ];
}

function ring(): readonly { latE7: number; lonE7: number }[] {
  const parsed = parseZoneRing(squareRing());
  assert.ok(parsed !== null);
  return parsed;
}

describe("parsing a stored polygon (D119)", () => {
  test("a closed ring of pairs parses unchanged", () => {
    assert.equal(parseZoneRing(squareRing())?.length, 5);
  });

  test("an open ring is closed rather than trusted", () => {
    const open = squareRing() as number[][];
    const parsed = parseZoneRing(open.slice(0, 4));
    assert.ok(parsed !== null);
    assert.equal(parsed.length, 5);
    assert.deepEqual(parsed[4], parsed[0]);
  });

  test("a triangle is a shape and a line is not", () => {
    assert.equal(
      parseZoneRing([
        [LON0, LAT0],
        [LON0 + 30 * STEP, LAT0],
        [LON0, LAT0 + 30 * STEP],
      ])?.length,
      4,
      "closed on the way out",
    );
    assert.equal(
      parseZoneRing([
        [LON0, LAT0],
        [LON0 + 30 * STEP, LAT0],
        [LON0 + 60 * STEP, LAT0],
      ]),
      null,
      "three collinear vertices have no interior, so they are not a shape",
    );
  });

  test("everything that is not the storage format is refused", () => {
    assert.equal(parseZoneRing(null), null);
    assert.equal(parseZoneRing("POLYGON((0 0))"), null);
    assert.equal(parseZoneRing([]), null);
    assert.equal(parseZoneRing([[LON0, LAT0], [LON0 + STEP, LAT0]]), null, "two vertices");
    assert.equal(parseZoneRing([[24.8981, 91.8698]]), null, "degrees, not E7 — and not pairs of integers");
    assert.equal(parseZoneRing([[LON0, LAT0], [LON0 + STEP, LAT0], [LON0, LAT0 + STEP, 0]]), null, "three numbers");
    assert.equal(parseZoneRing([[LON0, LAT0], [LON0 + STEP, LAT0], [LON0, 0.5]]), null, "a float coordinate");
    assert.equal(parseZoneRing([[LON0, LAT0], [LON0 + STEP, LAT0], [LON0, 999_999_999]]), null, "unreachable latitude");
  });

  test("a ring that closes without an interior is refused", () => {
    assert.equal(
      parseZoneRing([
        [LON0, LAT0],
        [LON0, LAT0],
      ]),
      null,
    );
  });
});

describe("inside the zone (filter 7)", () => {
  test("the origin and a point near it are inside, zero metres out", () => {
    assert.equal(insideZone(ring(), { latE7: LAT0, lonE7: LON0 }), true);
    assert.equal(distanceOutsideZoneM(ring(), { latE7: LAT0, lonE7: LON0 }), 0);
  });

  test("a rider standing on the boundary counts as inside", () => {
    const r = ring();
    for (const vertex of r) {
      assert.equal(distanceOutsideZoneM(r, vertex), 0, `vertex ${String(vertex.latE7)},${String(vertex.lonE7)}`);
    }
    const midEdge = { latE7: LAT0 - 45 * STEP, lonE7: LON0 };
    assert.equal(distanceOutsideZoneM(r, midEdge), 0, "the middle of an edge is still the edge");
  });

  test("one step outside the northern edge is 111 m, not more and not less", () => {
    const outside = { latE7: LAT0 + 45 * STEP + 4 * STEP, lonE7: LON0 };
    assert.equal(distanceOutsideZoneM(ring(), outside), 445, "4 × 111.19 m, rounded");
  });

  test("outside a corner the distance is to the corner, not to the nearest axis", () => {
    const r = ring();
    const corner = { latE7: LAT0 + 45 * STEP + 3 * STEP, lonE7: LON0 + 49 * STEP + 4 * STEP };
    const dLat = 3 * STEP;
    const dLon = 4 * STEP;
    const metres = haversineMeters({ latE7: LAT0 + 45 * STEP, lonE7: LON0 + 49 * STEP }, corner);
    assert.equal(dLat, 30_000);
    assert.equal(dLon, 40_000);
    assert.equal(distanceOutsideZoneM(r, corner), Math.round(metres), "the vertex distance is the truth here");
  });

  test("the distance grows as the rider moves further out", () => {
    const r = ring();
    const near = distanceOutsideZoneM(r, { latE7: LAT0 + 45 * STEP + 10 * STEP, lonE7: LON0 });
    const far = distanceOutsideZoneM(r, { latE7: LAT0 + 45 * STEP + 20 * STEP, lonE7: LON0 });
    assert.ok(near < far, `${String(near)} < ${String(far)}`);
    assert.equal(near, 1112, "10 × 111.19 m, rounded");
  });

  test("a notch in a concave zone is outside, even though the bounding box contains it", () => {
    // An L: the top-right quadrant is cut away.
    const l = parseZoneRing([
      [LON0, LAT0],
      [LON0 + 100 * STEP, LAT0],
      [LON0 + 100 * STEP, LAT0 + 50 * STEP],
      [LON0 + 50 * STEP, LAT0 + 50 * STEP],
      [LON0 + 50 * STEP, LAT0 + 100 * STEP],
      [LON0, LAT0 + 100 * STEP],
      [LON0, LAT0],
    ]);
    assert.ok(l !== null);
    assert.equal(distanceOutsideZoneM(l, { latE7: LAT0 + 20 * STEP, lonE7: LON0 + 20 * STEP }), 0, "inside the foot");
    assert.equal(insideZone(l, { latE7: LAT0 + 75 * STEP, lonE7: LON0 + 75 * STEP }), false, "in the cut corner");
    assert.ok(distanceOutsideZoneM(l, { latE7: LAT0 + 75 * STEP, lonE7: LON0 + 75 * STEP }) > 2_000);
    assert.equal(distanceOutsideZoneM(l, { latE7: LAT0 + 25 * STEP, lonE7: LON0 + 75 * STEP }), 0, "inside the arm");
  });

  test("a ring with no interior throws rather than answering zero", () => {
    const degenerate = [
      { latE7: LAT0, lonE7: LON0 },
      { latE7: LAT0, lonE7: LON0 },
      { latE7: LAT0, lonE7: LON0 },
      { latE7: LAT0, lonE7: LON0 },
    ];
    assert.equal(insideZone(degenerate, { latE7: LAT0, lonE7: LON0 }), false);
    assert.throws(() => distanceOutsideZoneM(degenerate, { latE7: LAT0, lonE7: LON0 }), RangeError);
    assert.throws(() => distanceOutsideZoneM([], { latE7: LAT0, lonE7: LON0 }), RangeError);
  });
});

describe("how wide a zone may be before the frame stops being honest", () => {
  test("a zone is a few kilometres across", () => {
    assert.ok(ringExtentM(ring()) < MAX_PLANAR_RING_M);
    assert.ok(ringExtentM(ring()) > 500, "and it is not a postage stamp either");
  });

  test("a 200 km shape is flagged by extent, which is the only thing that notices", () => {
    const huge = parseZoneRing([
      [LON0, LAT0],
      [LON0 + 2_000 * STEP, LAT0],
      [LON0 + 2_000 * STEP, LAT0 + 2_000 * STEP],
      [LON0, LAT0],
    ]);
    assert.ok(huge !== null);
    assert.ok(ringExtentM(huge) > MAX_PLANAR_RING_M);
  });
});

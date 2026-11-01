/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAT_CELL_DIVISOR, LON_CELL_DIVISOR, cellFor, cellsWithin } from "../../src/db/cell.ts";
import { generateVectors } from "../vectors.ts";

/** The generated column's formula, evaluated independently and exactly. */
function sqlCell(latE7: number, lonE7: number): bigint {
  const lat = BigInt(Math.trunc(latE7));
  const lon = BigInt(Math.trunc(lonE7));
  const latDiv = BigInt(LAT_CELL_DIVISOR);
  const lonDiv = BigInt(LON_CELL_DIVISOR);
  // BigInt division truncates toward zero; SQL FLOOR goes toward -infinity.
  const floorDiv = (value: bigint, divisor: bigint): bigint => {
    const quotient = value / divisor;
    return value % divisor !== 0n && value < 0n ? quotient - 1n : quotient;
  };
  return floorDiv(lat, latDiv) * 1_000_000n + floorDiv(lon, lonDiv);
}

describe("the 500-metre cell grid", () => {
  test("matches the generated column exactly, north and south of the equator", () => {
    const points: Array<[number, number]> = [
      [248_949_000, 918_687_000], // Sylhet
      [238_104_000, 908_414_000], // Dhaka
      [-33_868_800, 1_512_094_000], // Sydney: negative latitude
      [-1, -1],
      [0, 0],
      [44_920, 49_520],
      [449_199, 495_199],
    ];
    for (const [latE7, lonE7] of points) {
      assert.equal(BigInt(cellFor(latE7, lonE7)), sqlCell(latE7, lonE7), `cell at ${latE7},${lonE7}`);
    }
  });

  test("is stable across a random sweep of the platform's operating area", () => {
    for (const vector of generateVectors(2_000)) {
      const latE7 = 200_000_000 + (vector.amount % 80_000_000);
      const lonE7 = 880_000_000 + (vector.rateBps * 1_000);
      assert.equal(BigInt(cellFor(latE7, lonE7)), sqlCell(latE7, lonE7));
    }
  });

  test("the prefilter is a superset: a point inside the radius is in a returned cell", () => {
    const centre = { latE7: 248_949_000, lonE7: 918_687_000 };
    const cells = new Set(cellsWithin(centre.latE7, centre.lonE7, 2_000));
    assert.ok(cells.size >= 9, "a 2 km radius covers at least a 3x3 block of cells");
    // Walk the ring at the radius and just inside it.
    for (let bearing = 0; bearing < 360; bearing += 5) {
      for (const fraction of [0, 0.5, 0.99]) {
        const metres = 2_000 * fraction;
        const radians = (bearing * Math.PI) / 180;
        const latE7 = centre.latE7 + Math.round((metres * Math.cos(radians) * 1e7) / 111_320);
        // 111 320 m per degree of latitude; at Sylhet's 24.89° a degree of
        // longitude is 111 320 × cos(24.89°) ≈ 100 970 m.
        const lonE7 = centre.lonE7 + Math.round((metres * Math.sin(radians) * 1e7) / 100_970);
        assert.ok(
          cells.has(cellFor(latE7, lonE7)),
          `point at bearing ${bearing} and ${metres}m is missing from the prefilter`,
        );
      }
    }
  });

  test("refuses non-integer coordinates and a negative radius", () => {
    assert.throws(() => cellFor(1.5, 2), RangeError);
    assert.throws(() => cellsWithin(0, 0, -1), RangeError);
  });
});

/**
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The TypeScript half of the geospatial parity check.
 *
 * It reads one JSON document on stdin and prints one on stdout so `parity.py` can
 * diff the results against the Python mirror and against SQL. It calls the real
 * exported functions rather than a copy of their formulas: a probe that restates
 * the thing it probes agrees with itself and proves nothing.
 */

import { readFileSync } from "node:fs";

import { cellFor } from "../../packages/contracts/src/db/cell.ts";
import { haversineMeters, pointInRing } from "../../packages/contracts/src/db/geo.ts";

interface Input {
  cells: { lat_e7: number; lon_e7: number }[];
  distances: { a: [number, number]; b: [number, number] }[];
  rings: { point: [number, number]; ring: [number, number][] }[];
}

const point = (pair: [number, number]) => ({ latE7: pair[0], lonE7: pair[1] });

const input = JSON.parse(readFileSync(0, "utf8")) as Input;

process.stdout.write(
  JSON.stringify({
    cells: input.cells.map(({ lat_e7, lon_e7 }) => cellFor(lat_e7, lon_e7)),
    distances: input.distances.map(({ a, b }) => haversineMeters(point(a), point(b))),
    inside: input.rings.map(({ point: p, ring }) => pointInRing(point(p), ring.map(point))),
  }),
);

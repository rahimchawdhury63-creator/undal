/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The 500-metre cell grid, in integer arithmetic.
 *
 * TiDB has no spatial types and no user-defined functions, so the grid lives in
 * a generated column: `FLOOR(lat_e7 / 44920) * 1000000 + FLOOR(lon_e7 / 49520)`.
 * The same arithmetic has to exist in the Worker (to build the `IN (...)` list
 * that pre-filters a radius search) and in Python (for the nightly parity walk),
 * so the divisors are frozen constants here and a parity test fails the build if
 * the three disagree by one cell.
 */
export const LAT_CELL_DIVISOR = 44_920;
/**
 * 500 m of longitude at Sylhet's 24.9°, in degrees x 10⁷: 500 ÷ (111 320 × cos 24.9°).
 *
 * Frozen for the same reason as the latitude divisor, and for one more: cells get
 * slightly wider away from that latitude, which is harmless because the grid is
 * only a prefilter and the true distance is computed afterwards.
 */
export const LON_CELL_DIVISOR = 49_520;
/** How many longitude cells fit in one latitude row of the grid. */
const COLUMNS = 1_000_000;

/**
 * The cell id of a point, byte-identical to the generated column.
 *
 * `Math.floor` rather than `Math.trunc`: the SQL uses `FLOOR`, and southern or
 * western coordinates must land in the same cell in both places.
 */
export function cellFor(latE7: number, lonE7: number): number {
  if (!Number.isInteger(latE7) || !Number.isInteger(lonE7)) {
    throw new RangeError("cellFor takes integer degrees x 10^7");
  }
  return Math.floor(latE7 / LAT_CELL_DIVISOR) * COLUMNS + Math.floor(lonE7 / LON_CELL_DIVISOR);
}

/** The latitude row of the grid a cell belongs to. */
export function cellLatIndex(cellId: number): number {
  return Math.floor(cellId / COLUMNS);
}

/** The longitude column of the grid a cell belongs to. */
export function cellLonIndex(cellId: number): number {
  return ((cellId % COLUMNS) + COLUMNS) % COLUMNS;
}

/**
 * Every cell whose square could contain a point within `radiusM` of the centre.
 *
 * Returning a superset is the point: stage 1 is a cheap `IN (...)` filter, and
 * stage 2 computes the true haversine distance in the Worker. A superset that
 * misses a cell would silently drop a vendor from the results, so the bounds are
 * computed from the *cell corners* rather than from the centre, which is what
 * makes the guarantee hold at any latitude the platform serves.
 */
export function cellsWithin(latE7: number, lonE7: number, radiusM: number): number[] {
  if (radiusM < 0) {
    throw new RangeError("radius must not be negative");
  }
  // 111 320 m per degree of latitude; 1e7 units per degree.
  const latSpanE7 = Math.ceil((radiusM * 1e7) / 111_320);
  // Longitude shrinks with latitude; guard the cosine near the poles.
  const cosLat = Math.max(Math.cos((latE7 / 1e7) * (Math.PI / 180)), 0.01);
  const lonSpanE7 = Math.ceil((radiusM * 1e7) / (111_320 * cosLat));

  // One cell of slack on every side. The span is computed from a spherical
  // metres-per-degree figure, and a caller that measured its radius a little
  // differently must still get a superset: dropping a cell drops a vendor from
  // the results silently, while one extra cell costs two wasted rows.
  const firstRow = Math.floor((latE7 - latSpanE7) / LAT_CELL_DIVISOR) - 1;
  const lastRow = Math.floor((latE7 + latSpanE7) / LAT_CELL_DIVISOR) + 1;
  const firstColumn = Math.floor((lonE7 - lonSpanE7) / LON_CELL_DIVISOR) - 1;
  const lastColumn = Math.floor((lonE7 + lonSpanE7) / LON_CELL_DIVISOR) + 1;

  const cells: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      cells.push(row * COLUMNS + column);
    }
  }
  return cells;
}

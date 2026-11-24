/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { applyRate } from "../src/apply-rate.ts";
import { floorToTaka } from "../src/floor-to-taka.ts";
import { groupBdt } from "../src/group-bdt.ts";
import { generateVectors } from "./vectors.ts";

const VECTOR_COUNT = 110_000;
const OUT = new URL("../../../.artifacts/money/", import.meta.url);

/**
 * Write the vectors and this implementation's answers for the other two
 * languages to check against.
 *
 * The vectors go to disk rather than being regenerated in each language because
 * a differential test only means something if both sides multiply the *same*
 * numbers; two generators that agree today are two generators that will drift.
 */
function main(): void {
  mkdirSync(OUT, { recursive: true });
  const vectors = generateVectors(VECTOR_COUNT);
  writeFileSync(new URL("vectors.json", OUT), JSON.stringify(vectors));

  const answers = vectors.map(({ amount, rateBps }) => {
    const rate = applyRate(amount, rateBps);
    const floored = floorToTaka(amount);
    return [
      rate,
      floored.total,
      floored.delta,
      groupBdt(amount).amount,
      groupBdt(rate).withSymbol,
    ];
  });
  writeFileSync(new URL("ts.json", OUT), JSON.stringify(answers));
  process.stdout.write(`wrote ${vectors.length} vectors and TS answers to .artifacts/money/\n`);
}

main();

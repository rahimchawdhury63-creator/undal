/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The two languages must answer the same 110 000 money questions identically.
 *
 * TypeScript prices the order; Kotlin draws the number on the phone. If they disagree by one paisa
 * the customer is charged a different amount than the one they were shown, and no test in either
 * language can see it alone — only a comparison can. The vectors are generated once, in TypeScript,
 * and both languages answer the same file, so agreement here is agreement on the same questions
 * rather than two generators that happen to agree today.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = join(ROOT, ".artifacts/money");
const FIELDS = ["applyRate", "floor.total", "floor.delta", "group.amount", "group.withSymbol"];

function load(name) {
  try {
    return JSON.parse(readFileSync(join(ARTIFACTS, name), "utf8"));
  } catch (error) {
    console.error(`compare-money-answers: cannot read ${name}: ${error.message}`);
    process.exit(1);
  }
}

const vectors = load("vectors.json");
const ts = load("ts.json");
const kotlin = load("kotlin.json");

if (ts.length !== vectors.length || kotlin.length !== vectors.length) {
  console.error(
    `compare-money-answers: ${vectors.length} vectors, ${ts.length} TS answers, ${kotlin.length} Kotlin answers`,
  );
  process.exit(1);
}

let mismatches = 0;
for (let index = 0; index < vectors.length; index += 1) {
  for (let field = 0; field < FIELDS.length; field += 1) {
    const left = ts[index][field];
    const right = kotlin[index][field];
    if (left !== right) {
      mismatches += 1;
      if (mismatches <= 10) {
        const { amount, rateBps } = vectors[index];
        console.error(
          `compare-money-answers: vector ${index} (amount ${amount}, rate ${rateBps}) ` +
            `${FIELDS[field]}: TypeScript ${JSON.stringify(left)}, Kotlin ${JSON.stringify(right)}`,
        );
      }
    }
  }
}

console.log(
  mismatches === 0
    ? `compare-money-answers: ${vectors.length} vectors × ${FIELDS.length} fields agree`
    : `compare-money-answers: ${mismatches} disagreements`,
);
process.exit(mismatches === 0 ? 0 : 1);

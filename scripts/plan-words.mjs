/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Counts the master plan, honestly.
 *
 * A word target is easy to fake by pasting the same paragraph twice, so the count is produced by a
 * script that anybody can run, per file, from the files themselves. It reports the number; it does
 * not decide whether the number is good. `--require N` exits 1 when the plan is short.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = join(ROOT, "docs/_plan/plan");

const requireIndex = process.argv.indexOf("--require");
const required = requireIndex === -1 ? null : Number(process.argv[requireIndex + 1]);

const files = readdirSync(PLAN).filter((name) => name.endsWith(".md")).sort();
let total = 0;
const rows = [];
for (const name of files) {
  const text = readFileSync(join(PLAN, name), "utf8");
  const words = text.split(/\s+/u).filter((word) => word.length > 0).length;
  total += words;
  rows.push([name, words]);
}

const width = Math.max(...rows.map(([name]) => name.length));
for (const [name, words] of rows) console.log(`  ${name.padEnd(width)}  ${words}`);
console.log(`plan: ${rows.length} files, ${total} words${required === null ? "" : ` (required ${required})`}`);

if (required !== null && total < required) {
  console.error(`plan: short by ${required - total} words`);
  process.exit(1);
}

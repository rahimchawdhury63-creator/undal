/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The gate.
 *
 * Every claim this repository makes about itself is a command somebody has to remember to run.
 * That is how a green branch stops being true: nobody forgets on purpose, they forget because
 * there are fourteen commands and the fifteenth is the one that broke.
 *
 * So this runs all of them, in the order a failure would matter — the schemas and the guardrails
 * first, because a broken migration makes every test below it meaningless — and stops at the first
 * red one. It prints what it ran, how long it took, and the tail of the output that failed.
 *
 * `node scripts/verify.mjs --list` names the steps; `--only <name>` runs one, which is what you
 * want while fixing it; `--from <name>` starts there and keeps going.
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;

/** One check: what it is called, how to run it, and where. */
const STEPS = [
  {
    name: "guardrails",
    why: "the repository's own rules: size caps, licences, no invented keys",
    command: "python3 scripts/guardrails/run.py",
    cwd: ROOT,
  },
  {
    name: "schema-parity",
    why: "the specification's table inventory and the migrations name the same tables",
    command: "python3 scripts/db/check_schema_parity.py",
    cwd: ROOT,
  },
  {
    name: "schema-snapshot",
    why: "db/expected.json is what the migrations produce, not what they produced last month",
    command: "python3 scripts/db/expected.py && git diff --quiet -- db/expected.json",
    cwd: ROOT,
  },
  {
    name: "migrate-tests",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "the migration runner's own behaviour",
    command: "python3 scripts/db/test_migrate.py",
    cwd: ROOT,
  },
  {
    name: "api-surface",
    why: "docs/api/surface.json is the route table, and every route names a real permission",
    command: "node scripts/api-surface.mjs",
    cwd: ROOT,
  },
  {
    name: "operational-sql",
    why: "the 20 allowlisted operator queries name tables and columns that exist",
    command: "python3 scripts/db/integration.py --self-check",
    cwd: ROOT,
  },
  {
    name: "client-calls",
    why: "every path the shop and the console call is a route the Worker serves",
    command: "node scripts/check-client-calls.mjs",
    cwd: ROOT,
  },
  {
    name: "migration-policy",
    summaries: [/^Ran \d+ tests?/u, /^OK$/u],
    why: "every migration is idempotent, additive and shaped the way the rest of the schema is",
    command: "python3 scripts/db/test_migration_policy.py",
    cwd: ROOT,
  },
  {
    name: "sql-lint",
    why: "every statement the Workers build names a table and a column that exist",
    command: "python3 scripts/db/lint_sql.py --strict",
    cwd: ROOT,
  },
  {
    name: "sql-lint-tests",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "the linter fails when it should, not only passes when it should",
    command: "python3 scripts/db/test_lint_sql.py",
    cwd: ROOT,
  },
  {
    name: "tokens",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "the design tokens compile and their contrast pairs pass",
    command: "pnpm --filter @undal/tokens test",
    cwd: ROOT,
  },
  {
    name: "i18n",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "both locales carry the same keys and the same placeholders",
    command: "pnpm --filter @undal/i18n test",
    cwd: ROOT,
  },
  {
    name: "packages-types",
    okSummary: "no type errors",
    why: "contracts and money compile on their own",
    command: "pnpm --filter @undal/contracts exec tsc --noEmit && pnpm --filter @undal/money exec tsc --noEmit",
    cwd: ROOT,
  },
  {
    name: "core-types",
    okSummary: "no type errors",
    why: "the Worker compiles",
    command: "npx tsc --noEmit -p tsconfig.json",
    cwd: `${ROOT}workers/core`,
  },
  {
    name: "core-tests",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "the Worker answers what its routes promise",
    command: "node --experimental-strip-types --test test/*.test.ts",
    cwd: `${ROOT}workers/core`,
  },
  {
    name: "storefront-types",
    okSummary: "no type errors",
    why: "the shop compiles",
    command: "npx tsc --noEmit -p tsconfig.json",
    cwd: `${ROOT}web/storefront`,
  },
  {
    name: "storefront-tests",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "cart arithmetic, money and formatting",
    command: "node --experimental-strip-types --test test/*.test.ts",
    cwd: `${ROOT}web/storefront`,
  },
  {
    name: "storefront-build",
    why: "the shop builds and the prerender writes its pages",
    command: "pnpm run build",
    cwd: `${ROOT}web/storefront`,
  },
  {
    name: "storefront-deploy",
    why: "what the prerender wrote is deployable: pages, budget, no missing asset",
    command: "node scripts/verify-prerender.mjs",
    cwd: `${ROOT}web/storefront`,
  },
  {
    name: "admin-types",
    okSummary: "no type errors",
    why: "the console compiles",
    command: "npx tsc --noEmit -p tsconfig.json",
    cwd: `${ROOT}web/admin`,
  },
  {
    name: "admin-tests",
    summaries: [/^# tests \d+/u, /^# pass \d+/u, /^Ran \d+ tests?/u, /^OK$/u],
    why: "the console's API client and copy",
    command: "node --experimental-strip-types --test test/*.test.ts",
    cwd: `${ROOT}web/admin`,
  },
  {
    name: "admin-build",
    why: "the console builds",
    command: "pnpm run build",
    cwd: `${ROOT}web/admin`,
  },
  {
    name: "admin-deploy",
    why: "its Content Security Policy is the one that ships, and nothing escapes the base path",
    command: "node scripts/verify-csp.mjs",
    cwd: `${ROOT}web/admin`,
  },
];

/** The steps to run, honouring `--only` and `--from`. */
function selected(argv) {
  const only = argv.indexOf("--only") === -1 ? null : argv[argv.indexOf("--only") + 1];
  const from = argv.indexOf("--from") === -1 ? null : argv[argv.indexOf("--from") + 1];
  if (only !== null) {
    const step = STEPS.find((entry) => entry.name === only);
    if (step === undefined) {
      console.error(`verify: no step named "${only}". Steps: ${STEPS.map((entry) => entry.name).join(", ")}`);
      process.exit(2);
    }
    return [step];
  }
  if (from !== null) {
    const index = STEPS.findIndex((entry) => entry.name === from);
    if (index === -1) {
      console.error(`verify: no step named "${from}"`);
      process.exit(2);
    }
    return STEPS.slice(index);
  }
  return STEPS;
}

/**
 * The line worth showing for a step.
 *
 * `node:test` ends every run with `# duration_ms`, which says nothing; the numbers that matter are
 * two lines above it. So a step may name the patterns it wants, and the fallback prefers a line
 * that looks like a verdict over a line that looks like a timestamp.
 */
const VERDICT = [/^# pass \d+/u, /^# fail \d+/u, /^verify[a-z-]*:/u, /^lint-sql:/u, /^guardrails:/u, /^schema-parity:/u, /^expected:/u, /^prerender:/u, /^OK$/u, /built in/u];

function summaryOf(output, step) {
  const lines = output.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (step.summaries !== undefined) {
    const matched = lines.filter((line) => step.summaries.some((pattern) => pattern.test(line)));
    if (matched.length > 0) return matched.join(" · ");
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (VERDICT.some((pattern) => pattern.test(lines[index]))) return lines[index];
  }
  return lines.at(-1) ?? "";
}

/** Run one step, reporting its output only when it fails. */
function run(step) {
  const started = Date.now();
  const result = spawnSync(step.command, {
    cwd: step.cwd,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
  });
  const took = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
  // `tsc` prints nothing at all when it is happy; "nothing" is not a verdict worth printing.
  const summary = output === "" ? (step.okSummary ?? "") : summaryOf(output, step);
  console.log(`${ok ? "  ok  " : " FAIL "} ${step.name.padEnd(18)} ${took.padStart(6)}s  ${summary.slice(0, 120)}`);
  if (!ok) {
    console.error(`\nverify: ${step.name} failed — ${step.why}`);
    console.error(`verify: ${step.command}  (in ${step.cwd})`);
    const lines = output.split("\n");
    console.error(lines.slice(Math.max(0, lines.length - 40)).join("\n"));
  }
  return ok;
}

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const step of STEPS) console.log(`${step.name.padEnd(18)} ${step.why}`);
  process.exit(0);
}

console.log(`verify: ${selected(argv).length} steps\n`);
const started = Date.now();
let ran = 0;
for (const step of selected(argv)) {
  ran += 1;
  if (!run(step)) {
    console.error(`\nverify: stopped at step ${ran} of ${STEPS.length} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
    process.exit(1);
  }
}
console.log(`\nverify: ${ran} steps green in ${((Date.now() - started) / 1000).toFixed(1)}s`);

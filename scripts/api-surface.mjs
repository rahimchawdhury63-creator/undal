/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The API surface, published from the route table.
 *
 * `workers/core/src/app.ts` is the only place a route exists: the permission, the method, the path
 * template, whether it writes and how large a body it accepts all live there. A document written by
 * hand beside it drifts — always in the direction of the endpoints somebody wishes existed.
 *
 * So this generates the surface from the table, and fails when the committed file disagrees with it.
 * Two consequences worth naming:
 *
 *  - a client can generate types from `docs/api/surface.json` and be wrong only when the Worker is;
 *  - the invariants below are checked every time the file is regenerated, so a duplicate path or a
 *    write with no body bound is a red gate rather than a review comment.
 *
 * `--write` regenerates the file; without it, the file is compared and drift exits 1.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES } from "../workers/core/src/app.ts";
import { ALL_PERMISSION_KEYS } from "../workers/core/src/rbac/keys.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = resolve(ROOT, "docs/api/surface.json");
const KEYS = new Set(ALL_PERMISSION_KEYS);

/**
 * Parameters that predate this rule.
 *
 * Every path parameter is lower snake case except two, both added early: `{offerId}` on offer
 * accept and reject. Renaming them changes a path a partner app may already call, so they are
 * listed here — visibly, with the debt attached — rather than silently allowed by a looser pattern.
 */
const LEGACY_PARAMS = new Set(["{offerId}"]);

/** Group routes by their first segment after `/v1/`, which is how a reader navigates them. */
function domainOf(path) {
  const [, version, segment] = path.split("/");
  return version === "v1" ? segment : "(unversioned)";
}

const problems = [];
const seen = new Map();

for (const route of ROUTES) {
  const signature = `${route.method} ${route.path}`;
  if (seen.has(signature)) problems.push(`duplicate route: ${signature}`);
  seen.set(signature, route);

  // `/v1/` is the public surface and `/internal/` is what a cron trigger or a service binding
  // calls. Both are routes; only the first is a contract for a client.
  const isPublic = route.path.startsWith("/v1/");
  const isInternal = route.path.startsWith("/internal/");
  if (!isPublic && !isInternal) problems.push(`${signature}: path is neither /v1/ nor /internal/`);
  // `*` is the anonymous marker: a public catalogue route, or an internal one whose authority is
  // the binding rather than a token.
  if (route.permission !== "*" && !KEYS.has(route.permission)) {
    problems.push(`${signature}: permission "${route.permission}" is not in the register`);
  }
  // A write without a body bound accepts whatever the caller sends, which is how a Worker is made
  // to buffer a hundred megabytes on a phone's connection. A read (`quote`, `validate`) may still
  // take a body — that is what a POST that changes nothing looks like — so the bound is required
  // by method, not by the write flag.
  if (route.method === "POST" && route.maxBodyBytes === undefined) problems.push(`${signature}: a POST with no maxBodyBytes`);
  for (const param of route.path.match(/\{[a-zA-Z]+\}/gu) ?? []) {
    if (!/^\{[a-z]+\}$/u.test(param) && !LEGACY_PARAMS.has(param)) {
      problems.push(`${signature}: parameter ${param} is not lower snake case and is not a recorded exception`);
    }
  }
}

const surface = {
  note: "Generated from workers/core/src/app.ts by scripts/api-surface.mjs — do not edit by hand.",
  routes: ROUTES.length,
  permissions: new Set(ROUTES.map((route) => route.permission)).size,
  writes: ROUTES.filter((route) => route.write === true).length,
  entries: [...ROUTES]
    .map((route) => ({
      method: route.method,
      path: route.path,
      permission: route.permission,
      domain: domainOf(route.path),
      scope: route.path.startsWith("/internal/") ? "INTERNAL" : "PUBLIC",
      anonymous: route.permission === "*",
      write: route.write === true,
      ...(route.maxBodyBytes === undefined ? {} : { maxBodyBytes: route.maxBodyBytes }),
      ...(route.readOnly === true ? { readOnly: true } : {}),
    }))
    .sort((left, right) => (left.path + left.method).localeCompare(right.path + right.method)),
};

if (problems.length > 0) {
  for (const problem of problems) console.error(`api-surface: ${problem}`);
  process.exit(1);
}

const serialised = `${JSON.stringify(surface, null, 2)}\n`;
if (process.argv.includes("--write")) {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, serialised, "utf8");
  console.log(`api-surface: wrote ${surface.routes} routes, ${surface.writes} writes, ${surface.permissions} permissions`);
} else {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    console.error(`api-surface: ${TARGET} does not exist — run with --write`);
    process.exit(1);
  }
  if (current !== serialised) {
    console.error("api-surface: docs/api/surface.json is behind the route table — run with --write");
    process.exit(1);
  }
  console.log(`api-surface: ${surface.routes} routes, ${surface.writes} writes, ${surface.permissions} permissions, current`);
}

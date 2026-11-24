/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Every path a client calls must be a route the Worker serves.
 *
 * This is the failure a type system cannot catch: `apiCall("/v1/vendors/{id}/pause")` is a string,
 * and a typo in it compiles, builds, deploys and 404s — in the console, at 21:00, in front of the
 * person who needed it. The route table in `workers/core/src/app.ts` knows the truth, and
 * `docs/api/surface.json` is generated from it, so the clients can be checked against the same file
 * the Worker publishes.
 *
 * What it checks: every literal path in the two clients under `web`, its method (GET unless the call says
 * otherwise), and that each `{param}` in the route lines up with one dynamic segment in the call.
 *
 * What it cannot check: that the body matches the handler's expectations, or that the caller holds
 * the permission. Both need a server; both are on the list.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SURFACE = JSON.parse(readFileSync(join(ROOT, "docs/api/surface.json"), "utf8"));
const CLIENTS = ["web/storefront/src", "web/admin/src"];

/** The route templates, keyed by method and normalised path. */
const ROUTES = SURFACE.entries
  .filter((entry) => entry.scope === "PUBLIC")
  .map((entry) => ({ method: entry.method, path: entry.path, segments: entry.path.split("/").slice(1) }));

/** Every `.ts`/`.tsx` file under a directory. */
function filesUnder(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full));
      continue;
    }
    if (/\.tsx?$/u.test(name) && !/\.test\.ts$/u.test(name)) found.push(full);
  }
  return found;
}

/**
 * Normalise a call site into a route shape.
 *
 * `/v1/vendors/${encodeURIComponent(id)}/pause` becomes `/v1/vendors/{}/pause`: every interpolated
 * segment is one dynamic segment, and the route table says whether that is allowed there.
 */
function normalise(literal) {
  // A query string is not part of the path the router matches, and treating it as one reports
  // every filtered call as a missing route.
  const path = literal.split("?")[0];
  return path.replace(/\$\{[^}]*\}/gu, "{}");
}

const CALL = /(?:apiCall|apiRequest)(?:<[^>]*>)?\(\s*(["`])(\/v1\/[^"`]*)\1([\s\S]{0,160}?)\)/gu;

const problems = [];
let checked = 0;

for (const client of CLIENTS) {
  for (const file of filesUnder(join(ROOT, client))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) {
      const path = normalise(match[2]);
      const tail = match[3] ?? "";
      const method = /method:\s*"([A-Z]+)"/u.exec(tail)?.[1] ?? "GET";
      checked += 1;

      const segments = path.split("/").slice(1);
      const candidate = ROUTES.find(
        (route) =>
          route.method === method &&
          route.segments.length === segments.length &&
          route.segments.every((segment, index) => segment === segments[index] || (segment.startsWith("{") && segments[index] === "{}")),
      );
      if (candidate === undefined) {
        const near = ROUTES.filter((route) => route.segments[0] === segments[0] && route.method === method)
          .map((route) => route.path)
          .join(", ");
        problems.push(`${file.replace(`${ROOT}/`, "")}: ${method} ${path} is not a route (same domain: ${near || "none"})`);
      }
    }
  }
}

for (const problem of problems) console.error(`client-calls: ${problem}`);
console.log(
  problems.length === 0
    ? `client-calls: ${checked} call sites across ${CLIENTS.length} clients, all of them routes`
    : `client-calls: ${checked} call sites, ${problems.length} with no route`,
);
process.exit(problems.length === 0 ? 0 : 1);

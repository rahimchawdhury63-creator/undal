#!/usr/bin/env node
/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Prove the build is deployable before it is deployed.
 *
 * Deploying a directory whose `index.html` still contains the `<!--UNDAL_APP-->` slot would publish
 * a blank page that returns 200, which is the worst failure mode a static site has: crawlers index
 * it and support cannot reproduce it. This checks the slots are filled, that every page has a title
 * and a canonical link, that the sitemap and robots files exist, and that the JS budget was kept.
 *
 * Exit code 0 means deployable; 1 means the build must not ship.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(dirname(here), "dist");

/**
 * The largest initial JavaScript payload the brief allows, measured the way it is sent.
 *
 * Transfer size is the gzipped byte count, because that is what a customer on a 3G connection in
 * Sylhet actually downloads; a budget on uncompressed bytes measures the developer's disk.
 */
const JS_BUDGET_BYTES = 160 * 1024;

/** Every `index.html` under `dist`, depth-first. */
async function pages(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await pages(full)));
    else if (entry.name === "index.html") found.push(full);
  }
  return found;
}

const failures = [];
const files = await pages(dist);
if (files.length === 0) failures.push("dist contains no index.html");

for (const file of files) {
  const html = await readFile(file, "utf8");
  if (html.includes("<!--UNDAL_APP-->") || html.includes("<!--UNDAL_HEAD-->")) failures.push(`${file}: unfilled prerender slot`);
  if (!/<title>[^<]+<\/title>/u.test(html)) failures.push(`${file}: no title`);
  if (!/<link rel="canonical" href="[^"]+"/u.test(html)) failures.push(`${file}: no canonical link`);
  if (html.includes('id="root"></div>')) failures.push(`${file}: empty root`);
}

for (const required of ["sitemap.xml", "robots.txt", "404.html"]) {
  try {
    await stat(join(dist, required));
  } catch {
    failures.push(`dist/${required} is missing`);
  }
}

let jsBytes = 0;
for (const entry of await readdir(join(dist, "assets")).catch(() => [])) {
  if (!entry.endsWith(".js") || entry.endsWith(".js.map")) continue;
  jsBytes += gzipSync(await readFile(join(dist, "assets", entry))).byteLength;
}
if (jsBytes > JS_BUDGET_BYTES) failures.push(`initial JS gzips to ${Math.round(jsBytes / 1024)} KB, budget is ${JS_BUDGET_BYTES / 1024} KB`);

if (failures.length > 0) {
  process.stderr.write(`verify-prerender: ${failures.length} problem(s)\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`verify-prerender: ${files.length} pages, ${Math.round(jsBytes / 1024)} KB JS gzipped, deployable\n`);

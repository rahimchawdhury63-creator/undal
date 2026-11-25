#!/usr/bin/env node
/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * Prove the console's content-security policy before it is published.
 *
 * A CSP is easy to write and easy to invalidate: one inline event handler, one `unsafe-eval` added
 * to make a dev tool work, one absolute asset URL outside `/admin`, and the header either breaks
 * the application or stops protecting it. The deploy workflow runs this after the build, and a
 * failure means the bundle does not ship.
 *
 * The checks are deliberately readable rather than clever, because the person reading a red run at
 * 2 am needs to know which rule failed and where.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const dist = join(root, "dist");
const adminBase = (process.env["PUBLIC_ADMIN_BASE"] ?? "/admin").replace(/\/$/u, "");

const failures = [];
const notes = [];

/** Read a file or record that it is missing. */
async function read(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch {
    failures.push(`${label} is missing (${path})`);
    return null;
  }
}

const html = await read(join(dist, "index.html"), "dist/index.html");
const headers = await read(join(dist, "_headers"), "dist/_headers");

if (headers !== null) {
  // The block must be scoped to the console's path, so it can never widen the storefront's policy.
  const scoped = new RegExp(`^${adminBase}/\\*$`, "mu").test(headers);
  if (!scoped) failures.push(`_headers has no block for ${adminBase}/*`);

  const cspLine = headers.split("\n").find((line) => line.toLowerCase().includes("content-security-policy"));
  if (cspLine === undefined) {
    failures.push("_headers carries no Content-Security-Policy");
  } else {
    const policy = cspLine.slice(cspLine.indexOf(":") + 1).trim();
    const directives = new Map(
      policy.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/u);
        return [name ?? "", values.join(" ")];
      }),
    );
    const require = (name, expected) => {
      const value = directives.get(name);
      if (value === undefined) failures.push(`CSP has no ${name}`);
      else if (value !== expected) failures.push(`CSP ${name} is "${value}", expected "${expected}"`);
    };
    require("default-src", "'self'");
    require("script-src", "'self'");
    require("frame-ancestors", "'none'");
    require("object-src", "'none'");
    require("base-uri", "'none'");
    require("connect-src", "'self'");
    if (/unsafe-eval/u.test(policy)) failures.push("CSP allows unsafe-eval");
    if (/unsafe-inline/u.test(directives.get("script-src") ?? "")) failures.push("CSP allows inline script");
    if (/https?:\/\//u.test(directives.get("connect-src") ?? "")) failures.push("CSP connect-src names an external host");
    for (const header of ["X-Content-Type-Options: nosniff", "Referrer-Policy: same-origin", "Cache-Control: no-store"]) {
      if (!headers.includes(header)) failures.push(`_headers is missing "${header}"`);
    }
    notes.push(`policy: ${policy.slice(0, 72)}…`);
  }
}

if (html !== null) {
  // Inline script is the one thing a `script-src 'self'` policy forbids outright.
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gu)].filter(
    (match) => (match[1] ?? "").trim() !== "",
  );
  if (inlineScripts.length > 0) failures.push(`index.html has ${inlineScripts.length} inline script(s)`);
  if (/<style[\s>]/u.test(html)) failures.push("index.html has an inline <style> element");
  const handlers = [...html.matchAll(/\son[a-z]+\s*=/gu)].map((match) => match[0].trim());
  if (handlers.length > 0) failures.push(`index.html has inline handlers: ${handlers.join(", ")}`);

  // Every asset must sit under the console's base, or Pages serves the storefront's 404.
  const sources = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1] ?? "");
  const absolute = sources.filter((source) => source.startsWith("/"));
  const outside = absolute.filter((source) => !source.startsWith(`${adminBase}/`));
  if (outside.length > 0) failures.push(`assets outside ${adminBase}/: ${outside.join(", ")}`);
  if (sources.length === 0) failures.push("index.html references no assets");
  notes.push(`${sources.length} asset reference(s), all under ${adminBase}/`);
}

// A source map in a private bundle is a readable copy of the console's code.
try {
  const assets = await readdir(join(dist, "assets"));
  const maps = assets.filter((entry) => entry.endsWith(".map"));
  if (maps.length > 0) failures.push(`${maps.length} source map(s) published in dist/assets`);
} catch {
  failures.push("dist/assets is missing");
}

// The entry HTML must not be the empty shell a failed build leaves behind.
if (html !== null && !html.includes('id="root"')) failures.push("index.html has no #root");

try {
  const size = (await stat(join(dist, "index.html"))).size;
  if (size < 200) failures.push(`index.html is ${size} bytes, which is not a page`);
} catch {
  failures.push("dist/index.html is unreadable");
}

if (failures.length > 0) {
  process.stderr.write(`verify-csp: ${failures.length} problem(s)\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`verify-csp: scoped to ${adminBase}/*, ${notes.join("; ")}, publishable\n`);

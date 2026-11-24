#!/usr/bin/env node
/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Prerender the storefront into static HTML.
 *
 * Runs after `vite build` and `vite build --ssr`, never inside it: the client build has already
 * placed hashed assets in `dist/`, so the pages written here reference files that exist. Each page
 * is rendered through the same route table the browser uses, so a loader that breaks the browser
 * breaks the build instead of shipping a page nobody can load.
 *
 * Environment:
 *   PUBLIC_API_BASE — the API the sitemap is read from, default `http://127.0.0.1:8787`
 *   PUBLIC_SITE_URL — the canonical origin, default `https://undal.app`
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const dist = join(root, "dist");
const siteUrl = (process.env.PUBLIC_SITE_URL ?? "https://undal.app").replace(/\/$/u, "");
const apiBase = (process.env.PUBLIC_API_BASE ?? siteUrl.replace("https://undal.app", "http://127.0.0.1:8787")).replace(/\/$/u, "");

/** The routes that exist without any data, and therefore must always be written. */
const STATIC_PATHS = [
  "/",
  "/about",
  "/help",
  "/contact",
  "/privacy",
  "/terms",
  "/licence",
  "/app",
  "/join/restaurant",
  "/join/rider",
  "/partner",
  "/rider",
  "/search",
  "/cart",
  "/checkout",
  "/account",
  "/sign-in",
];

/** Read the catalogue's sitemap feed, or report that there is none. */
async function sitemapData() {
  try {
    const response = await fetch(`${apiBase}/v1/public/sitemap-data`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Write one page to `dist/<path>/index.html`, or `dist/index.html` for the root. */
async function writePage(template, render, path) {
  const { html, head, status } = await render(path);
  if (html === "") {
    process.stderr.write(`prerender: ${path} returned status ${status}, skipped\n`);
    return false;
  }
  const document = template.replace("<!--UNDAL_HEAD-->", head).replace("<!--UNDAL_APP-->", html);
  const target = path === "/" ? join(dist, "index.html") : join(dist, path.replace(/^\//u, ""), "index.html");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, document, "utf8");
  return true;
}

/** Write a `sitemap.xml` and a `robots.txt` from the routes that were actually produced. */
async function writeCrawlerFiles(paths) {
  const entries = paths
    .filter((path) => !["/cart", "/checkout", "/account", "/sign-in", "/search"].includes(path))
    .map(
      (path) =>
        `  <url><loc>${siteUrl}${path}</loc><xhtml:link rel="alternate" hreflang="bn" href="${siteUrl}${path}?lang=bn"/><xhtml:link rel="alternate" hreflang="en" href="${siteUrl}${path}?lang=en"/></url>`,
    )
    .join("\n");
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    entries,
    "</urlset>",
    "",
  ].join("\n");
  await writeFile(join(dist, "sitemap.xml"), xml, "utf8");
  await writeFile(
    join(dist, "robots.txt"),
    ["User-agent: *", "Allow: /", "Disallow: /cart", "Disallow: /checkout", "Disallow: /account", `Sitemap: ${siteUrl}/sitemap.xml`, ""].join(
      "\n",
    ),
    "utf8",
  );
  await writeFile(join(dist, "404.html"), await readFile(join(dist, "index.html"), "utf8"), "utf8");
}

async function main() {
  const template = await readFile(join(dist, "index.html"), "utf8");
  const serverEntry = pathToFileURL(join(dist, "server", "entry-server.js")).href;
  const { render } = await import(serverEntry);

  const data = await sitemapData();
  if (data === null) {
    process.stdout.write(`prerender: no catalogue at ${apiBase}; writing the static pages only\n`);
  }

  const paths = new Set(STATIC_PATHS);
  for (const vendor of data?.vendors ?? []) paths.add(`/r/${vendor.slug}`);
  for (const area of data?.areas ?? []) paths.add(`/a/${area.slug}`);
  for (const category of data?.categories ?? []) paths.add(`/c/${category.slug}`);

  let written = 0;
  for (const path of paths) {
    if (await writePage(template, render, path)) written += 1;
  }
  await writeCrawlerFiles([...paths]);
  process.stdout.write(`prerender: wrote ${written} of ${paths.size} pages from ${siteUrl}\n`);
}

await main();

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Document head, shared by the prerender pass and the browser.
 *
 * The prerender pass renders each route to HTML and then asks the same route for this metadata,
 * so what a crawler reads and what a browser updates on client-side navigation come from one
 * description rather than two that drift. Nothing here trusts user input into an HTML attribute:
 * every value is escaped before it reaches a tag.
 */

import { useEffect } from "react";

/** What a route says about itself. */
export interface Meta {
  readonly title: string;
  readonly description: string;
  /** Path relative to the site root, used for the canonical link. */
  readonly path: string;
  readonly locale: "bn" | "en";
  /** Structured data for the page, serialised as JSON-LD. */
  readonly jsonLd?: Record<string, unknown> | null;
  /** `noindex` for cart, checkout and account: pages with no search intent and private data. */
  readonly noindex?: boolean;
}

/** Escape a string for an HTML attribute or text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** Serialise JSON-LD safely: a `</script>` inside a name must not close the element. */
export function jsonLdScript(data: Record<string, unknown>): string {
  const json = JSON.stringify(data).replace(/</gu, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * The tags a prerendered page carries.
 *
 * `hreflang` alternates are emitted for every route because every route exists in both languages;
 * a Bangladeshi search result should land on Bangla and an English query on English, and the
 * `?lang=` parameter is what the prerender and the toggle both use.
 */
export function renderHead(meta: Meta, siteUrl: string): string {
  const canonical = `${siteUrl}${meta.path}`;
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<link rel="alternate" hreflang="bn" href="${escapeHtml(`${canonical}?lang=bn`)}" />`,
    `<link rel="alternate" hreflang="en" href="${escapeHtml(`${canonical}?lang=en`)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Undal" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:locale" content="${meta.locale === "bn" ? "bn_BD" : "en_US"}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  if (meta.noindex === true) tags.push('<meta name="robots" content="noindex, nofollow" />');
  if (meta.jsonLd !== undefined && meta.jsonLd !== null) tags.push(jsonLdScript(meta.jsonLd));
  return tags.join("\n    ");
}

/** Apply a route's metadata in the browser, on mount and on every client-side navigation. */
export function useHead(meta: Meta, siteUrl: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = meta.title;
    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (tag === null) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };
    setMeta("description", meta.description);
    setMeta("robots", meta.noindex === true ? "noindex, nofollow" : "index, follow");
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical === null) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", `${siteUrl}${meta.path}`);
  }, [meta.title, meta.description, meta.path, meta.noindex, siteUrl]);
}

/** The site's own address, used for canonicals and structured data. */
export const SITE_URL = "https://undal.app";

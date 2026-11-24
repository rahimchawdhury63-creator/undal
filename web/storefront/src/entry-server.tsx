/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The prerender entry.
 *
 * Given a path, run the same route table through a static handler so every loader executes, then
 * render to a string. The metadata is taken from the matched leaf route's `handle.meta` with its
 * loader data, which is what keeps a vendor page's title honest: it is the kitchen's name, not the
 * word "vendor".
 */

import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { routes } from "./routes.tsx";
import { SITE_URL, renderHead, type Meta } from "./lib/seo.ts";
import type { RouteHandle } from "./routes.tsx";

/** One prerendered page: its body markup, its head tags and the response status. */
export interface PrerenderResult {
  readonly html: string;
  readonly head: string;
  readonly status: number;
}

const handler = createStaticHandler(routes);

/**
 * Render one path.
 *
 * A path that matches no route renders the 404 page with status 404 but still produces HTML, which
 * is what a static host needs in order to serve something useful for an unknown URL.
 */
export async function render(path: string): Promise<PrerenderResult> {
  const url = new URL(path, SITE_URL);
  const context = await handler.query(new Request(url.toString(), { method: "GET" }));
  if (context instanceof Response) {
    return { html: "", head: "", status: context.status };
  }
  const router = createStaticRouter(routes, context);
  const html = renderToString(<StaticRouterProvider router={router} context={context} hydrate={false} />);

  const leaf = context.matches[context.matches.length - 1];
  const handle = leaf?.route.handle as RouteHandle | undefined;
  const data = leaf === undefined ? undefined : context.loaderData?.[leaf.route.id ?? ""];
  const meta: Meta = handle === undefined ? { title: "Undal", description: "", path, locale: "bn" } : handle.meta(data);
  return { html, head: renderHead({ ...meta, path }, SITE_URL), status: 200 };
}

/** The component React Router needs in scope for the static renderer's JSX. */
export type RendererComponent = ComponentType;

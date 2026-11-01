/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { createRouter, type Route, type WorkerEnv } from "./router.ts";

/**
 * The registered routes.
 *
 * Empty in this response on purpose: the catalogue, order, cash and admin routes
 * arrive with the modules they belong to, and a route that exists before its
 * module would have to invent data to answer with. Resource handlers are added
 * to this array, never accumulated in the dispatcher.
 */
const ROUTES: readonly Route[] = [];

/**
 * The Worker's entry point.
 *
 * A single fetch handler and no `scheduled` export: every periodic job in Undal
 * is a GitHub Actions workflow, so this Worker has no wake-up surface that could
 * silently stop firing.
 */
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const route = createRouter(ROUTES, env);
    return route(request);
  },
};

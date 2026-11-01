/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { createApp } from "./app.ts";
import type { Env } from "./middleware/context.ts";

/**
 * `undal-core`, the API Worker.
 *
 * One `fetch` export and deliberately no `scheduled` export: every periodic job in Undal
 * is a GitHub Actions workflow, so this Worker has no wake-up surface that could stop
 * firing without a red run to say so.
 *
 * The environment is passed straight through to `createApp`, which builds the database
 * handle per request. Nothing here reads `process.env` or holds a module-level connection:
 * an isolate can be evicted between two requests, and a cached handle is a failed request
 * whose cause looks random.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createApp()(request, env);
  },
};

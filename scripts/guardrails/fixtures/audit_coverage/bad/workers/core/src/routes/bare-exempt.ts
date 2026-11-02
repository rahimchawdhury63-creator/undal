/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

// audit-exempt: too short.

export const ROUTES = [{ method: "POST", path: "/internal/whatever", run: async () => new Response("{}") }];

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

// audit-exempt: the statements it runs write lock rows and coordinator state, whose effects are recorded
// by the caller that decided to change them; a row per statement would be a trace of SQL, not of decisions.

export const ROUTES = [{ method: "POST", path: "/internal/coordination/statements", run: async () => new Response("{}") }];

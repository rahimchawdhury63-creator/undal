/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

export const route = { method: 'POST', path: '/v1/orders' };
export async function handler() { await audit.write({}); }

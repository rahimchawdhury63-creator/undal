/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The growth readers: campaigns and referrals.
 *
 * Two lists and no switches. Starting a campaign, pausing one, or paying a referral reward are
 * each their own permission and their own route, and none of them exists yet — so this file reads
 * and says nothing it cannot back with a statement.
 *
 * One detail is worth the code it costs: the budget and the redeemed amount are gated on
 * `promo.campaign.view_budget`, separately from the list's own `promo.campaign.list`. A growth
 * report that anybody with the list key can read is a report that leaks how much the platform
 * spends per city, and the split already exists in the permission register, so the route honours
 * it rather than rendering the number and calling it context.
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { toHexId } from "../lib/ids.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import { roleAllows } from "../rbac/roles.ts";
import {
  isCampaignKind,
  isReferralStatus,
  listCampaigns,
  listReferrals,
  tallyReferrals,
  type CampaignRow,
  type ReferralRow,
} from "../repositories/growth.ts";

/** The page sizes the two lists accept. */
const MAX_CAMPAIGNS = 200;
const DEFAULT_CAMPAIGNS = 100;
const MAX_REFERRALS = 100;
const DEFAULT_REFERRALS = 25;

/** Whether the caller may see what a campaign costs. */
function maySeeBudget(ctx: Ctx): boolean {
  return ctx.principal !== null && roleAllows(ctx.principal.role ?? "", "promo.campaign.view_budget");
}

/** Whether the caller may see what the referral queue owes. */
function maySeePayouts(ctx: Ctx): boolean {
  return ctx.principal !== null && roleAllows(ctx.principal.role ?? "", "promo.referral.view_payouts");
}

/** A campaign as the console reads it, with the money fields only when they are permitted. */
function serialiseCampaign(row: CampaignRow, withBudget: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: toHexId(row.id),
    name: row.name,
    kind: row.kind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    active: row.active === true || row.active === 1 || row.active === "1",
    redemptions: Number(row.redemptions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!withBudget) return base;
  const budget = row.budget_paisa === null ? null : Number(row.budget_paisa);
  const spent = row.spent_paisa === null ? null : Number(row.spent_paisa);
  return {
    ...base,
    budget: {
      period: row.budget_period,
      budgetPaisa: budget,
      spentPaisa: spent,
      // What is left is the number a reviewer actually acts on; a null budget means none was set,
      // which is not the same as a budget of zero and must not read as "spent out".
      remainingPaisa: budget === null || spent === null ? null : budget - spent,
    },
    redeemedPaisa: Number(row.redeemed_paisa),
  };
}

/** A referral as the console reads it. Two ids, a code, a state; no people. */
function serialiseReferral(row: ReferralRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    referrerId: toHexId(row.referrer_id),
    refereeId: toHexId(row.referee_id),
    code: row.code,
    status: row.status,
    rewardPaisa: Number(row.reward_paisa),
    qualifiedAt: row.qualified_at,
    createdAt: row.created_at,
  };
}

/** A `422` that names the field the caller has to fix. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** `GET /v1/campaigns`. */
async function campaigns(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;

  const rawActive = params.get("active");
  let active: boolean | null = null;
  if (rawActive !== null) {
    if (rawActive !== "true" && rawActive !== "false") return invalid(ctx, "active");
    active = rawActive === "true";
  }

  const rawKind = params.get("kind");
  if (rawKind !== null && !isCampaignKind(rawKind.toUpperCase())) return invalid(ctx, "kind");

  const rawLimit = Number(params.get("limit") ?? DEFAULT_CAMPAIGNS);
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > MAX_CAMPAIGNS) return invalid(ctx, "limit");

  const rows = await listCampaigns(ctx.db, {
    active,
    kind: rawKind === null ? null : rawKind.toUpperCase(),
    q: params.get("q"),
    limit: Math.floor(rawLimit),
  });
  const withBudget = maySeeBudget(ctx);
  return successResponse(
    { campaigns: rows.map((row) => serialiseCampaign(row, withBudget)), limit: Math.floor(rawLimit), budgetVisible: withBudget },
    ctx.locale,
    ctx.requestId,
  );
}

/** `GET /v1/referrals`. */
async function referrals(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;

  const rawStatus = params.get("status");
  if (rawStatus !== null && !isReferralStatus(rawStatus.toUpperCase())) return invalid(ctx, "status");

  const rawLimit = Number(params.get("limit") ?? DEFAULT_REFERRALS);
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > MAX_REFERRALS) return invalid(ctx, "limit");

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && cursor === null) return invalid(ctx, "cursor");

  const limit = Math.floor(rawLimit);
  const rows = await listReferrals(ctx.db, {
    status: rawStatus === null ? null : rawStatus.toUpperCase(),
    q: params.get("q"),
    cursor,
    limit,
  });

  const tally = await tallyReferrals(ctx.db);
  const last = rows[rows.length - 1];
  const withPayouts = maySeePayouts(ctx);
  return successResponse(
    {
      referrals: rows.map(serialiseReferral),
      // The tally describes the table, not the page, and says so in its field names.
      tally: {
        pending: tally.pending,
        qualified: tally.qualified,
        rewarded: tally.rewarded,
        void: tally.void,
        ...(withPayouts ? { owedPaisa: tally.owedPaisa } : {}),
      },
      payoutsVisible: withPayouts,
      nextCursor: rows.length === limit && last !== undefined ? encodeCursor(last.created_at, toHexId(last.id)) : null,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The growth routes. */
export const GROWTH_ROUTES: readonly RouteDefinition[] = [
  { method: "GET", path: "/v1/campaigns", permission: "promo.campaign.list", group: "ADMIN_WRITE", run: (ctx) => campaigns(ctx) },
  { method: "GET", path: "/v1/referrals", permission: "promo.referral.list", group: "ADMIN_WRITE", run: (ctx) => referrals(ctx) },
];

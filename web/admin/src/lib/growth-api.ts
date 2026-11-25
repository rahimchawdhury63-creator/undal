/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The growth readers' wire shapes.
 *
 * In their own module because `api.ts` had reached its line budget, and because these two readers
 * are the one pair in the console whose responses can be missing fields the caller may not see:
 * the budget and the payout tally are withheld per role, so the types say `optional` and the
 * screens check for absence instead of trusting a zero.
 */

import { apiCall } from "./api.ts";

/** One campaign as the console reads it. The budget fields arrive only with the budget key. */
export interface AdminCampaign {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly active: boolean;
  readonly redemptions: number;
  readonly budget?: {
    readonly period: string | null;
    readonly budgetPaisa: number | null;
    readonly spentPaisa: number | null;
    readonly remainingPaisa: number | null;
  };
  readonly redeemedPaisa?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One referral: two ids, a code, a state and a reward. Never a person. */
export interface AdminReferral {
  readonly id: string;
  readonly referrerId: string;
  readonly refereeId: string;
  readonly code: string;
  readonly status: string;
  readonly rewardPaisa: number;
  readonly qualifiedAt: string | null;
  readonly createdAt: string;
}

/** The campaigns, most recently started first. */
export async function listCampaigns(
  token: string,
  query: { active?: string | null; kind?: string | null; q?: string | null; limit?: number } = {},
): Promise<{ readonly campaigns: readonly AdminCampaign[]; readonly limit: number; readonly budgetVisible: boolean }> {
  return apiCall("/v1/campaigns", { token, query });
}

/** The referrals, with the tally over the whole table. */
export async function listReferrals(
  token: string,
  query: { status?: string | null; q?: string | null; limit?: number } = {},
): Promise<{
  readonly referrals: readonly AdminReferral[];
  readonly tally: { pending: number; qualified: number; rewarded: number; void: number; owedPaisa?: number };
  readonly payoutsVisible: boolean;
  readonly nextCursor: string | null;
}> {
  return apiCall("/v1/referrals", { token, query });
}

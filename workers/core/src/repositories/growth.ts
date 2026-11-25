/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Campaigns and referrals, as an operator reads them.
 *
 * Growth is the one part of the platform where the money leaves without a customer seeing a price:
 * a campaign spends a budget, a referral promises a reward. So both readers carry the number that
 * matters next to the row — what a campaign has spent against its budget, and how many referrals
 * are waiting to be paid — instead of making a reviewer open the table themselves.
 *
 * There is a deliberate absence here: no personal data. A referral list is a list of two user ids,
 * a code and a reward; the phone numbers behind those ids belong to `kyc` and `analytics.export`
 * permissions, not to whoever can read a growth report.
 */

import type { Db } from "../db/client.ts";

/** The four campaign kinds the schema allows. */
export const CAMPAIGN_KINDS = ["DISCOUNT", "FREE_DELIVERY", "BONUS", "REFERRAL"] as const;

/** Whether a string is a campaign kind. */
export function isCampaignKind(value: unknown): boolean {
  return typeof value === "string" && (CAMPAIGN_KINDS as readonly string[]).includes(value);
}

/** The four referral states. */
export const REFERRAL_STATUSES = ["PENDING", "QUALIFIED", "REWARDED", "VOID"] as const;

/** Whether a string is a referral status. */
export function isReferralStatus(value: unknown): value is (typeof REFERRAL_STATUSES)[number] {
  return typeof value === "string" && (REFERRAL_STATUSES as readonly string[]).includes(value);
}

/**
 * The columns a campaign row shows.
 *
 * The budget and the spend are the *latest* period the campaign has, which is the current one while
 * the monthly job runs. Reading them by `ORDER BY period DESC LIMIT 1` rather than by comparing
 * against today's date keeps the statement free of a time zone: the period string is written by the
 * job, and the reader believes it rather than recomputing it.
 */
export const CAMPAIGN_COLUMNS =
  "`c`.`id`, `c`.`name`, `c`.`kind`, `c`.`starts_at`, `c`.`ends_at`, `c`.`active`, `c`.`created_at`, `c`.`updated_at`, " +
  "(SELECT `b`.`period` FROM `campaign_budgets` `b` WHERE `b`.`campaign_id` = `c`.`id` ORDER BY `b`.`period` DESC LIMIT 1) AS `budget_period`, " +
  "(SELECT `b`.`budget_paisa` FROM `campaign_budgets` `b` WHERE `b`.`campaign_id` = `c`.`id` ORDER BY `b`.`period` DESC LIMIT 1) AS `budget_paisa`, " +
  "(SELECT `b`.`spent_paisa` FROM `campaign_budgets` `b` WHERE `b`.`campaign_id` = `c`.`id` ORDER BY `b`.`period` DESC LIMIT 1) AS `spent_paisa`, " +
  "(SELECT COUNT(*) FROM `campaign_redemptions` `r` WHERE `r`.`campaign_id` = `c`.`id`) AS `redemptions`, " +
  "(SELECT COALESCE(SUM(`r`.`amount_paisa`), 0) FROM `campaign_redemptions` `r` WHERE `r`.`campaign_id` = `c`.`id`) AS `redeemed_paisa`";

/** One campaign row, with its budget and its redemptions. */
export interface CampaignRow {
  readonly id: Uint8Array;
  readonly name: string;
  readonly kind: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly active: number | string | boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly budget_period: string | null;
  readonly budget_paisa: number | string | null;
  readonly spent_paisa: number | string | null;
  readonly redemptions: number | string;
  readonly redeemed_paisa: number | string;
}

/** What an operator may narrow campaigns by. */
export interface CampaignFilter {
  readonly active: boolean | null;
  readonly kind: string | null;
  readonly q: string | null;
  readonly limit: number;
}

/** Escape the wildcards a caller could type into a search box. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/**
 * The campaigns, most recently started first.
 *
 * No cursor: a platform runs a handful of campaigns at a time — a banner budget per city per month —
 * and the list is a screen, not a table to page through. The limit is bounded anyway.
 */
export async function listCampaigns(db: Db, filter: CampaignFilter): Promise<CampaignRow[]> {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (filter.active !== null) {
    where.push("`c`.`active` = ?");
    params.push(filter.active ? 1 : 0);
  }
  if (filter.kind !== null) {
    where.push("`c`.`kind` = ?");
    params.push(filter.kind);
  }
  if (filter.q !== null && filter.q.trim() !== "") {
    where.push("`c`.`name` LIKE ?");
    params.push(`%${escapeLike(filter.q.trim())}%`);
  }
  params.push(filter.limit);
  return db.query<CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM \`campaigns\` \`c\` WHERE ${where.join(" AND ")} ` +
      "ORDER BY `c`.`starts_at` DESC, `c`.`id` DESC LIMIT ?",
    params,
  );
}

/** One referral, without the people behind it. */
export interface ReferralRow {
  readonly id: Uint8Array;
  readonly referrer_id: Uint8Array;
  readonly referee_id: Uint8Array;
  readonly code: string;
  readonly status: string;
  readonly reward_paisa: number | string;
  readonly qualified_at: string | null;
  readonly created_at: string;
}

/** The columns a referral row shows. */
export const REFERRAL_COLUMNS =
  "`x`.`id`, `x`.`referrer_id`, `x`.`referee_id`, `x`.`code`, `x`.`status`, `x`.`reward_paisa`, " +
  "`x`.`qualified_at`, `x`.`created_at`";

/** What an operator may narrow referrals by. */
export interface ReferralFilter {
  readonly status: string | null;
  readonly q: string | null;
  readonly cursor: { readonly createdAt: string; readonly id: Uint8Array } | null;
  readonly limit: number;
}

/** One page of referrals, newest first. */
export async function listReferrals(db: Db, filter: ReferralFilter): Promise<ReferralRow[]> {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (filter.status !== null) {
    where.push("`x`.`status` = ?");
    params.push(filter.status);
  }
  if (filter.q !== null && filter.q.trim() !== "") {
    where.push("`x`.`code` LIKE ?");
    params.push(`%${escapeLike(filter.q.trim().toUpperCase())}%`);
  }
  if (filter.cursor !== null) {
    where.push("(`x`.`created_at` < ? OR (`x`.`created_at` = ? AND `x`.`id` < ?))");
    params.push(filter.cursor.createdAt, filter.cursor.createdAt, filter.cursor.id);
  }
  params.push(filter.limit);
  return db.query<ReferralRow>(
    `SELECT ${REFERRAL_COLUMNS} FROM \`referrals\` \`x\` WHERE ${where.join(" AND ")} ` +
      "ORDER BY `x`.`created_at` DESC, `x`.`id` DESC LIMIT ?",
    params,
  );
}

/** How many referrals sit in each state, and what the unpaid ones are worth. */
export interface ReferralTally {
  readonly pending: number;
  readonly qualified: number;
  readonly rewarded: number;
  readonly void: number;
  /** Reward owed on the referrals that have qualified but not been paid. */
  readonly owedPaisa: number;
}

/**
 * The tally across the whole table, not the page.
 *
 * A page of twenty referrals says nothing about whether the reward queue is healthy, so this
 * counts the table. It is one grouped statement against an index that exists for exactly this
 * shape (`idx_referral_referrer` starts with the referrer, so the count scans; at referral volumes
 * this is a nightly-report cost and not a per-request one, and it is one statement either way).
 */
export async function tallyReferrals(db: Db): Promise<ReferralTally> {
  const rows = await db.query<{ status: string; n: number | string; owed: number | string | null }>(
    "SELECT `status`, COUNT(*) AS `n`, COALESCE(SUM(`reward_paisa`), 0) AS `owed` FROM `referrals` GROUP BY `status`",
  );
  let pending = 0;
  let qualified = 0;
  let rewarded = 0;
  let voided = 0;
  let owedPaisa = 0;
  for (const row of rows) {
    const count = Number(row.n);
    if (row.status === "PENDING") pending = count;
    else if (row.status === "QUALIFIED") {
      qualified = count;
      owedPaisa += Number(row.owed ?? 0);
    } else if (row.status === "REWARDED") rewarded = count;
    else if (row.status === "VOID") voided = count;
  }
  return { pending, qualified, rewarded, void: voided, owedPaisa };
}

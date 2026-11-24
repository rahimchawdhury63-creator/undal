/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The growth board: what a campaign costs, and what the referral queue owes.
 *
 * Two readers, no switches. A reviewer opens this screen to answer one of two questions — is the
 * Eid campaign about to run out of budget, and how much referral reward is waiting to be paid — so
 * both answers are on the screen before any row is read.
 *
 * When the API withholds a number, the screen says so instead of drawing a zero. A budget rendered
 * as ৳0 to somebody without the budget key would be worse than no budget at all: it reads as truth.
 */

import { useState, type ReactNode } from "react";

import { listCampaigns, listReferrals, type AdminCampaign, type AdminReferral } from "../lib/growth-api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { Badge, Button, Empty, ErrorNote, Field, Kpi, Money, Note, Select, Table } from "../components/kit.tsx";

/** The referral states the filter offers. */
const REFERRAL_STATUSES = ["PENDING", "QUALIFIED", "REWARDED", "VOID"] as const;

/** How much of a budget is gone. */
function budgetTone(spent: number, budget: number): "success" | "warning" | "danger" {
  if (budget <= 0) return "warning";
  const share = spent / budget;
  if (share >= 1) return "danger";
  if (share >= 0.8) return "warning";
  return "success";
}

/** The growth board. */
export function GrowthPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const [status, setStatus] = useState<"ALL" | (typeof REFERRAL_STATUSES)[number]>("ALL");

  const campaigns = useResource(async () => listCampaigns(token, { limit: 100 }), [token]);
  const referrals = useResource(
    async () => listReferrals(token, { ...(status === "ALL" ? {} : { status }), limit: 50 }),
    [token, status],
  );

  const rows = campaigns.data?.campaigns ?? [];
  const tally = referrals.data?.tally;

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.growth.title")}</h1>

      <section aria-label={t("admin.growth.campaigns")}>
        <h2 style={{ fontSize: "var(--type-heading-md-size)" }}>{t("admin.growth.campaigns")}</h2>
        <p style={{ maxWidth: "68ch", color: "var(--color-text-secondary)" }}>{t("admin.growth.campaignsIntro")}</p>
        <Button variant="quiet" onClick={campaigns.reload} busy={campaigns.loading}>
          {t("action.retry")}
        </Button>
        {campaigns.error === null ? null : <ErrorNote error={campaigns.error} onRetry={campaigns.reload} />}
        {campaigns.data !== null && rows.length === 0 && campaigns.error === null ? (
          <Empty title={t("admin.growth.noCampaigns.title")} body={t("admin.growth.noCampaigns.body")} />
        ) : (
          <Table
            caption={t("admin.growth.campaigns")}
            head={
              <tr>
                <th scope="col">{t("admin.growth.campaign")}</th>
                <th scope="col">{t("admin.growth.kind")}</th>
                <th scope="col">{t("admin.growth.window")}</th>
                <th scope="col">{t("admin.growth.budget")}</th>
                <th scope="col">{t("admin.growth.redemptions")}</th>
                <th scope="col">{t("admin.growth.state")}</th>
              </tr>
            }
          >
            {rows.map((campaign: AdminCampaign) => (
              <tr key={campaign.id}>
                <td>
                  <strong>{campaign.name}</strong>
                </td>
                <td>{campaign.kind}</td>
                <td>
                  {t.dateTime(campaign.startsAt, "day")}
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                    {campaign.endsAt === null ? t("admin.growth.openEnded") : t.dateTime(campaign.endsAt, "day")}
                  </div>
                </td>
                <td>
                  {campaign.budget === undefined ? (
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>{t("admin.growth.budgetHidden")}</span>
                  ) : campaign.budget.budgetPaisa === null ? (
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>{t("admin.growth.noBudget")}</span>
                  ) : (
                    <>
                      <Money paisa={campaign.budget.remainingPaisa ?? 0} />
                      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                        {t("admin.growth.ofBudget")} <Money paisa={campaign.budget.budgetPaisa} />
                      </div>
                      <Badge tone={budgetTone(campaign.budget.spentPaisa ?? 0, campaign.budget.budgetPaisa)}>
                        {t("admin.growth.spent")} {campaign.budget.period ?? "—"}
                      </Badge>
                    </>
                  )}
                </td>
                <td>{t.number(campaign.redemptions)}</td>
                <td>
                  <Badge tone={campaign.active ? "success" : "neutral"}>
                    {campaign.active ? t("admin.growth.live") : t("admin.growth.paused")}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section aria-label={t("admin.growth.referrals")}>
        <h2 style={{ fontSize: "var(--type-heading-md-size)" }}>{t("admin.growth.referrals")}</h2>
        <div
          style={{
            display: "grid",
            gap: "var(--space-3)",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
          }}
        >
          <Kpi label={t("admin.growth.pending")} value={tally === undefined ? "—" : t.number(tally.pending)} hint={t("admin.growth.pendingHint")} />
          <Kpi label={t("admin.growth.qualified")} value={tally === undefined ? "—" : t.number(tally.qualified)} hint={t("admin.growth.qualifiedHint")} />
          <Kpi label={t("admin.growth.rewarded")} value={tally === undefined ? "—" : t.number(tally.rewarded)} hint={t("admin.growth.rewardedHint")} />
          <Kpi
            label={t("admin.growth.owed")}
            value={
              referrals.data === null || !referrals.data.payoutsVisible
                ? "—"
                : t.money(tally?.owedPaisa ?? 0)
            }
            tone={referrals.data?.payoutsVisible === true && (tally?.owedPaisa ?? 0) > 0 ? "warning" : "neutral"}
            hint={referrals.data?.payoutsVisible === false ? t("admin.growth.payoutsHidden") : t("admin.growth.owedHint")}
          />
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field id="referral-status" label={t("admin.growth.status")}>
            <Select
              id="referral-status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "ALL" as const, label: t("admin.growth.anyStatus") },
                ...REFERRAL_STATUSES.map((value) => ({ value, label: t(`admin.growth.status.${value}` as never) })),
              ]}
            />
          </Field>
          <Button variant="quiet" onClick={referrals.reload} busy={referrals.loading}>
            {t("action.retry")}
          </Button>
        </div>

        {referrals.error === null ? null : <ErrorNote error={referrals.error} onRetry={referrals.reload} />}
        {referrals.data !== null && (referrals.data.referrals.length === 0) && referrals.error === null ? (
          <Empty title={t("admin.growth.noReferrals.title")} body={t("admin.growth.noReferrals.body")} />
        ) : (
          <Table
            caption={t("admin.growth.referrals")}
            head={
              <tr>
                <th scope="col">{t("admin.growth.code")}</th>
                <th scope="col">{t("admin.growth.state")}</th>
                <th scope="col">{t("admin.growth.reward")}</th>
                <th scope="col">{t("admin.growth.invited")}</th>
                <th scope="col">{t("admin.growth.qualifiedAt")}</th>
              </tr>
            }
          >
            {(referrals.data?.referrals ?? []).map((referral: AdminReferral) => (
              <tr key={referral.id}>
                <td>
                  <code>{referral.code}</code>
                </td>
                <td>
                  <Badge tone={referral.status === "REWARDED" ? "success" : referral.status === "VOID" ? "danger" : "neutral"}>
                    {referral.status}
                  </Badge>
                </td>
                <td>
                  <Money paisa={referral.rewardPaisa} />
                </td>
                <td>{t.relative(referral.createdAt)}</td>
                <td>{referral.qualifiedAt === null ? "—" : t.dateTime(referral.qualifiedAt, "day")}</td>
              </tr>
            ))}
          </Table>
        )}
        <Note>{t("admin.growth.privacy")}</Note>
      </section>
    </>
  );
}

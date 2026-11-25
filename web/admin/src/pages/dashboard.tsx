/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The morning screen.
 *
 * Four numbers and the five claims nearest their deadline, because that is what an operations
 * shift actually opens with: how much money is unaccounted for, how long the oldest claim has
 * waited, how many exceptions are open, and what the order book looks like. Each tile is a link to
 * the screen that can act on it — a dashboard that reports without routing is a dashboard people
 * stop opening.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

import { declarationQueue, listOrders, settlementQueue } from "../lib/api.ts";
import { useCounts } from "../lib/counts.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { AmountCell, Badge, Empty, ErrorNote, Kpi, Money, Table } from "../components/kit.tsx";

/** The shift's opening numbers. */
export function DashboardPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)();
  const publish = useCounts((state) => state.publish);

  const settlements = useResource(async () => settlementQueue(token ?? "", { state: "pending", limit: 5 }), [token]);
  const declarations = useResource(async () => declarationQueue(token ?? "", { state: "open", limit: 1 }), [token]);
  const orders = useResource(async () => listOrders(token ?? "", 100), [token]);

  const settlementSummary = settlements.data?.summary;
  const declarationSummary = declarations.data?.summary;
  const orderRows = orders.data?.orders ?? [];
  const openOrders = orderRows.filter((order) => !["DELIVERED", "SETTLED", "CANCELLED"].includes(order.state));
  const outstandingPaisa = (settlements.data?.settlements ?? []).reduce((sum, entry) => sum + entry.amountPaisa, 0);

  // Publish what this screen learned so the sidebar agrees with it.
  if (settlementSummary !== undefined || declarationSummary !== undefined) {
    queueMicrotask(() => publish(settlementSummary?.pending ?? null, declarationSummary?.total ?? null));
  }

  const firstError = settlements.error ?? declarations.error ?? orders.error;

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.domain.orders")}</h1>
      {firstError === null ? null : <ErrorNote error={firstError} onRetry={() => {
        settlements.reload();
        declarations.reload();
        orders.reload();
      }} />}

      <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        <Link to="/cash/settlements">
          <Kpi
            label={t("admin.cash.pending")}
            value={settlementSummary === undefined ? "—" : t.number(settlementSummary.pending)}
            hint={t("admin.cash.queueHint")}
            tone={settlementSummary !== undefined && settlementSummary.breaches > 0 ? "danger" : "neutral"}
          />
        </Link>
        <Link to="/cash/settlements">
          <Kpi
            label={t("admin.kpi.cashOutstanding")}
            value={settlements.data === null ? "—" : t.money(outstandingPaisa)}
            hint={t("admin.cash.outstandingHint")}
          />
        </Link>
        <Link to="/cash/declarations">
          <Kpi
            label={t("admin.exceptions")}
            value={declarationSummary === undefined ? "—" : t.number(declarationSummary.total)}
            hint={t("admin.declarations.hint")}
          />
        </Link>
        <Link to="/orders">
          <Kpi label={t("admin.orders.title")} value={orders.data === null ? "—" : t.number(openOrders.length)} hint={t("admin.orders.hint")} />
        </Link>
      </div>

      <section aria-label={t("admin.cash.title")} style={{ display: "grid", gap: "var(--space-2)" }}>
        <h2 style={{ fontSize: "var(--type-heading-md-size)" }}>{t("admin.cash.nearestDeadline")}</h2>
        {(settlements.data?.settlements ?? []).length === 0 ? (
          <Empty title={t("admin.cash.empty.title")} body={t("admin.cash.empty.body")} />
        ) : (
          <Table
            caption={t("admin.cash.nearestDeadline")}
            head={
              <tr>
                <th scope="col">{t("admin.cash.rider")}</th>
                <th scope="col">{t("admin.cash.amount")}</th>
                <th scope="col">{t("admin.cash.age")}</th>
                <th scope="col">{t("admin.cash.status")}</th>
              </tr>
            }
          >
            {(settlements.data?.settlements ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{entry.rider.name ?? entry.rider.code ?? entry.rider.id.slice(0, 8)}</td>
                <AmountCell>
                  <Money paisa={entry.amountPaisa} />
                </AmountCell>
                <td style={{ color: entry.slaBreached ? "var(--color-status-danger)" : undefined }}>
                  {entry.ageMinutes === null ? "—" : t.minutes(entry.ageMinutes)}
                </td>
                <td>
                  <Badge tone={entry.slaBreached ? "danger" : "warning"}>{entry.slaBreached ? t("admin.cash.flag.sla") : entry.status}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </>
  );
}

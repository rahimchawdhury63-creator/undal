/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The order board.
 *
 * Every order the platform will show this account, newest first, with the state the platform last
 * committed to. It is deliberately read-only: the moves that change an order belong to the kitchen
 * that accepted it and the rider carrying it, and an operator who can silently move an order is an
 * operator who can hide a delay instead of escalating one.
 */

import { useState, type ReactNode } from "react";

import { listOrders, type OrderRow } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { AmountCell, Badge, Button, Empty, ErrorNote, Money, Table } from "../components/kit.tsx";

/** How a state is coloured: done, moving, or ended badly. */
function toneFor(state: string): "success" | "live" | "warning" | "danger" | "neutral" {
  if (state === "DELIVERED" || state === "SETTLED") return "success";
  if (state === "CANCELLED" || state === "REJECTED" || state === "FAILED" || state === "DISPUTED") return "danger";
  if (state === "PLACED" || state === "ACCEPTED" || state === "PREPARING") return "warning";
  if (state === "PICKED_UP" || state === "ARRIVED" || state === "RIDER_ASSIGNED" || state === "RIDER_SEARCH") return "live";
  return "neutral";
}

/** The board. */
export function OrdersPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)();
  const [filter, setFilter] = useState<"all" | "open" | "done">("open");
  const orders = useResource(async () => listOrders(token ?? "", 100), [token]);

  const rows = (orders.data?.orders ?? []).filter((order) => {
    if (filter === "all") return true;
    const done = order.state === "DELIVERED" || order.state === "SETTLED" || order.state === "CANCELLED";
    return filter === "done" ? done : !done;
  });

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.orders.title")}</h1>
      <div style={{ display: "flex", gap: "var(--space-2)" }} role="group" aria-label={t("admin.orders.title")}>
        {(["open", "done", "all"] as const).map((option) => (
          <Button key={option} variant={filter === option ? "primary" : "secondary"} onClick={() => setFilter(option)}>
            {t(`admin.orders.view.${option}` as never)}
          </Button>
        ))}
      </div>

      {orders.error === null ? null : <ErrorNote error={orders.error} onRetry={orders.reload} />}

      {rows.length === 0 && orders.error === null ? (
        <Empty title={t("admin.orders.empty.title")} body={t("admin.orders.empty.body")} />
      ) : (
        <Table
          caption={t("admin.orders.title")}
          head={
            <tr>
              <th scope="col">{t("admin.orders.code")}</th>
              <th scope="col">{t("admin.orders.state")}</th>
              <th scope="col">{t("admin.orders.total")}</th>
              <th scope="col">{t("admin.orders.vendor")}</th>
              <th scope="col">{t("admin.orders.rider")}</th>
              <th scope="col">{t("admin.orders.age")}</th>
            </tr>
          }
        >
          {rows.map((order: OrderRow) => (
            <tr key={order.id}>
              <td style={{ fontFamily: "var(--font-family-mono)" }}>{order.code}</td>
              <td>
                <Badge tone={toneFor(order.state)}>{order.state}</Badge>
              </td>
              <AmountCell>
                <Money paisa={order.money.totalPaisa} />
              </AmountCell>
              <td style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{order.vendorId.slice(0, 8)}</td>
              <td style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{order.riderId === null ? t("admin.orders.noRider") : order.riderId.slice(0, 8)}</td>
              <td>{t.relative(order.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

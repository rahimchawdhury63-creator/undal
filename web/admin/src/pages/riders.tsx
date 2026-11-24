/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The fleet board.
 *
 * A supervisor opening this screen at 21:00 is asking three questions: who is working, who cannot
 * work, and how much cash is out. The tiles answer all three before any row is read, and the
 * `CASH_LOCKED` filter is one tap away because that is the only state where the platform is
 * holding a rider back and the clock is the platform's fault, not theirs.
 *
 * There are no switches on the rows. Suspending a rider is a step-up action with an audit reason
 * and a support conversation behind it; a button here would be a route the platform does not have.
 */

import { useState, type ReactNode } from "react";

import { listRiders, type AdminRider } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { AmountCell, Badge, Button, Empty, ErrorNote, Field, Kpi, Money, Select, Table } from "../components/kit.tsx";

/** The shift states the list can filter on. */
const SHIFT_STATES = ["OFFLINE", "VERIFYING", "ONLINE", "ON_ORDER", "BREAK", "CASH_LOCKED"] as const;

/** How a shift state reads. */
function shiftTone(state: string): "success" | "live" | "warning" | "danger" | "neutral" {
  if (state === "ONLINE" || state === "ON_ORDER") return "live";
  if (state === "CASH_LOCKED") return "danger";
  if (state === "BREAK" || state === "VERIFYING") return "warning";
  return "neutral";
}

/** The fleet board. */
export function RidersPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const [shift, setShift] = useState<"ALL" | (typeof SHIFT_STATES)[number]>("ALL");
  const [query, setQuery] = useState("");

  const fleet = useResource(
    async () =>
      listRiders(token, {
        ...(shift === "ALL" ? {} : { shiftState: shift }),
        ...(query.trim() === "" ? {} : { q: query.trim() }),
        limit: 50,
      }),
    [token, shift, query],
  );

  const summary = fleet.data?.summary;

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.fleet.title")}</h1>

      <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        <Kpi label={t("admin.fleet.online")} value={summary === undefined ? "—" : t.number(summary.online)} hint={t("admin.fleet.onlineHint")} />
        <Kpi
          label={t("admin.fleet.cashLocked")}
          value={summary === undefined ? "—" : t.number(summary.cashLocked)}
          tone={summary !== undefined && summary.cashLocked > 0 ? "danger" : "neutral"}
          hint={t("admin.fleet.cashLockedHint")}
        />
        <Kpi label={t("admin.fleet.cashOut")} value={summary === undefined ? "—" : t.money(summary.outstandingPaisa)} hint={t("admin.fleet.cashOutHint")} />
        <Kpi label={t("admin.fleet.inList")} value={summary === undefined ? "—" : t.number(summary.total)} hint={t("admin.fleet.inListHint")} />
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field id="rider-shift" label={t("admin.fleet.filter")}>
          <Select
            id="rider-shift"
            value={shift}
            onChange={setShift}
            options={[
              { value: "ALL" as const, label: t("admin.fleet.anyState") },
              ...SHIFT_STATES.map((value) => ({ value, label: t(`admin.fleet.state.${value}` as never) })),
            ]}
          />
        </Field>
        <Field id="rider-search" label={t("admin.fleet.search")}>
          <input
            id="rider-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{
              minHeight: "var(--layout-tap-target-min)",
              paddingInline: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg-surface)",
            }}
          />
        </Field>
        <Button variant="quiet" onClick={fleet.reload} busy={fleet.loading}>
          {t("action.retry")}
        </Button>
      </div>

      {fleet.error === null ? null : <ErrorNote error={fleet.error} onRetry={fleet.reload} />}

      {fleet.data !== null && fleet.data.riders.length === 0 && fleet.error === null ? (
        <Empty title={t("admin.fleet.empty.title")} body={t("admin.fleet.empty.body")} />
      ) : (
        <Table
          caption={t("admin.fleet.title")}
          head={
            <tr>
              <th scope="col">{t("admin.fleet.rider")}</th>
              <th scope="col">{t("admin.fleet.state")}</th>
              <th scope="col">{t("admin.fleet.vehicle")}</th>
              <th scope="col">{t("admin.fleet.cash")}</th>
              <th scope="col">{t("admin.fleet.onboarding")}</th>
              <th scope="col">{t("admin.fleet.since")}</th>
            </tr>
          }
        >
          {(fleet.data?.riders ?? []).map((rider: AdminRider) => (
            <tr key={rider.id}>
              <td>
                <strong>{rider.name}</strong>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{rider.code}</div>
              </td>
              <td>
                <Badge tone={shiftTone(rider.shiftState)}>{rider.shiftState}</Badge>
              </td>
              <td>{rider.vehicle}</td>
              <AmountCell>
                {rider.outstandingPayoutPaisa === 0 ? "—" : <Money paisa={rider.outstandingPayoutPaisa} />}
              </AmountCell>
              <td>
                <Badge tone={rider.status === "APPROVED" ? "success" : rider.status === "SUSPENDED" ? "danger" : "neutral"}>{rider.status}</Badge>
              </td>
              <td>{t.relative(rider.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

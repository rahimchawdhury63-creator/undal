/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The zone board.
 *
 * Two numbers sit beside every zone — live kitchens and approved riders — because that pair is the
 * only reason an operator opens this screen before a shift: a zone with kitchens and no riders is
 * an area that will fall behind, and a zone with no kitchens is an area that has not launched.
 *
 * The switch is a pause with a named reason, taken from the register the audit trail accepts. There
 * is no free-text reason here on purpose: an operator closing an entire area at 20:00 should be
 * choosing from "unsafe" and "weather", and the reviewer reading it in March should be able to count
 * how often each one happened.
 *
 * Pausing is refused by the server while orders are in flight, and the refusal carries the count.
 * The dialog says so before the click, because the alternative is an operator learning it from an
 * error after the decision has already been explained to a customer.
 */

import { useState, type ReactNode } from "react";

import { activateZone, listZones, pauseZone, toApiError, type AdminZone } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { Badge, Button, Dialog, Empty, ErrorNote, Field, Note, Select, Table, TextArea } from "../components/kit.tsx";

/** The statuses the board can filter on. */
const STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "RETIRED"] as const;

/**
 * The reasons the server accepts for closing an area.
 *
 * These are the register's codes for `zone.deactivate`, copied rather than fetched: the register is
 * a static table in a package the console already depends on, and a network round trip to discover
 * four strings would be a way to render an empty dropdown when the API is down.
 */
const PAUSE_REASONS = ["ZONE_UNSAFE", "WEATHER_EMERGENCY", "CUSTOMER_REQUESTED", "OPERATOR_ERROR", "LEGAL_REQUEST"] as const;

/** How a zone status reads. */
function statusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED") return "warning";
  if (status === "RETIRED") return "danger";
  return "neutral";
}

/** The zone board. */
export function ZonesPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const [status, setStatus] = useState<"ALL" | (typeof STATUSES)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [closing, setClosing] = useState<AdminZone | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const zones = useResource(
    async () =>
      listZones(token, {
        ...(status === "ALL" ? {} : { status }),
        ...(query.trim() === "" ? {} : { q: query.trim() }),
        limit: 200,
      }),
    [token, status, query],
  );

  const act = async (work: () => Promise<unknown>, successKey: string) => {
    try {
      await work();
      setOutcome(t(successKey as never));
      setClosing(null);
      zones.reload();
    } catch (failure) {
      setOutcome(toApiError(failure).code);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.zones.title")}</h1>
      <p style={{ maxWidth: "68ch", color: "var(--color-text-secondary)" }}>{t("admin.zones.intro")}</p>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field id="zone-status" label={t("admin.zones.filter")}>
          <Select
            id="zone-status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL" as const, label: t("admin.zones.anyStatus") },
              ...STATUSES.map((value) => ({ value, label: t(`admin.zones.status.${value}` as never) })),
            ]}
          />
        </Field>
        <Field id="zone-search" label={t("admin.zones.search")}>
          <input
            id="zone-search"
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
        <Button variant="quiet" onClick={zones.reload} busy={zones.loading}>
          {t("action.retry")}
        </Button>
      </div>

      {outcome === null ? null : <Note>{outcome}</Note>}
      {zones.error === null ? null : <ErrorNote error={zones.error} onRetry={zones.reload} />}

      {zones.data !== null && zones.data.zones.length === 0 && zones.error === null ? (
        <Empty title={t("admin.zones.empty.title")} body={t("admin.zones.empty.body")} />
      ) : (
        <Table
          caption={t("admin.zones.title")}
          head={
            <tr>
              <th scope="col">{t("admin.zones.zone")}</th>
              <th scope="col">{t("admin.zones.state")}</th>
              <th scope="col">{t("admin.zones.vendors")}</th>
              <th scope="col">{t("admin.zones.riders")}</th>
              <th scope="col">{t("admin.zones.area")}</th>
              <th scope="col">{t("admin.zones.switch")}</th>
            </tr>
          }
        >
          {(zones.data?.zones ?? []).map((zone: AdminZone) => (
            <tr key={zone.id}>
              <td>
                <strong>{zone.name}</strong>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                  {zone.code} · {zone.city}
                </div>
              </td>
              <td>
                <Badge tone={statusTone(zone.status)}>{zone.status}</Badge>
              </td>
              <td>{t.number(zone.counts.vendors)}</td>
              <td>{t.number(zone.counts.riders)}</td>
              <td>{t.number(Math.round(zone.areaSqKm))} km²</td>
              <td>
                {zone.status === "ACTIVE" ? (
                  <Button variant="quiet" onClick={() => setClosing(zone)}>
                    {t("admin.zones.close")}
                  </Button>
                ) : null}
                {zone.status === "PAUSED" ? (
                  <Button variant="quiet" onClick={() => void act(() => activateZone(token, zone.id), "admin.zones.reopened")}>
                    {t("admin.zones.reopen")}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {closing === null ? null : (
        <CloseDialog
          zone={closing}
          onClose={() => setClosing(null)}
          onSubmit={(reasonCode, note) =>
            void act(() => pauseZone(token, closing.id, reasonCode, note), "admin.zones.closed")
          }
        />
      )}
    </>
  );
}

/** The dialog that closes an area. */
function CloseDialog({
  zone,
  onClose,
  onSubmit,
}: {
  readonly zone: AdminZone;
  readonly onClose: () => void;
  readonly onSubmit: (reasonCode: string, note: string | null) => void;
}): ReactNode {
  const t = useT();
  const [reasonCode, setReasonCode] = useState<string>(PAUSE_REASONS[0]);
  const [note, setNote] = useState("");
  const trimmed = note.trim();

  return (
    <Dialog
      title={t("admin.zones.closeTitle")}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button onClick={() => onSubmit(reasonCode, trimmed.length >= 3 ? trimmed : null)}>
            {t("admin.zones.close")}
          </Button>
        </>
      }
    >
      <p>
        <strong>{zone.name}</strong> · {t.number(zone.counts.vendors)} {t("admin.zones.vendors").toLowerCase()}
      </p>
      <Note>{t("admin.zones.closeWarning")}</Note>
      <Field id="zone-reason" label={t("admin.zones.reason")}>
        <Select
          id="zone-reason"
          value={reasonCode}
          onChange={setReasonCode}
          options={PAUSE_REASONS.map((value) => ({ value, label: t(`admin.zones.reason.${value}` as never) }))}
        />
      </Field>
      <Field id="zone-note" label={t("admin.zones.note")}>
        <TextArea id="zone-note" value={note} onChange={setNote} maxLength={200} />
      </Field>
    </Dialog>
  );
}

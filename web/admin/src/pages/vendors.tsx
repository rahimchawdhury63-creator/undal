/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The vendor list, and the two switches an operator has.
 *
 * A pause is the interesting control: it must carry a reason the partner app can show and it must
 * carry an end, because a kitchen that is closed "until further notice" is one the owner cannot
 * plan around and the customer cannot wait for. So the dialog offers quarter-hour steps up to two
 * hours and a reason of at least three characters, and the server enforces the same bounds.
 */

import { useState, type ReactNode } from "react";

import { listVendors, pauseVendor, resumeVendor, toApiError, type AdminVendor } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { AmountCell, Badge, Button, Dialog, Empty, ErrorNote, Field, Note, Select, Table, TextArea } from "../components/kit.tsx";

/** The statuses the list can filter on, in the onboarding order the domain uses. */
const STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO", "APPROVED", "SUSPENDED", "REJECTED", "RETIRED"] as const;

/** The pause lengths offered. Every one of them is a value an owner can plan around. */
const PAUSE_MINUTES = [15, 30, 60, 120] as const;

/** How a vendor's open state reads to an operator. */
function openTone(openState: string): "success" | "warning" | "neutral" | "danger" {
  if (openState === "OPEN") return "success";
  if (openState === "PAUSED") return "warning";
  if (openState === "UNREACHABLE") return "danger";
  return "neutral";
}

/** The vendor list, with pause and resume. */
export function VendorsPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const [status, setStatus] = useState<"ALL" | (typeof STATUSES)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [pausing, setPausing] = useState<AdminVendor | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const vendors = useResource(
    async () =>
      listVendors(token, {
        ...(status === "ALL" ? {} : { status }),
        ...(query.trim() === "" ? {} : { q: query.trim() }),
        limit: 50,
      }),
    [token, status, query],
  );

  const act = async (work: () => Promise<unknown>, successKey: string) => {
    try {
      await work();
      setOutcome(t(successKey as never));
      setPausing(null);
      vendors.reload();
    } catch (failure) {
      setOutcome(toApiError(failure).code);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.vendors.title")}</h1>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field id="vendor-status" label={t("admin.vendors.filter")}>
          <Select
            id="vendor-status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL" as const, label: t("admin.vendors.anyStatus") },
              ...STATUSES.map((value) => ({ value, label: t(`admin.vendors.status.${value}` as never) })),
            ]}
          />
        </Field>
        <Field id="vendor-search" label={t("admin.vendors.search")}>
          <input
            id="vendor-search"
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
        <Button variant="quiet" onClick={vendors.reload} busy={vendors.loading}>
          {t("action.retry")}
        </Button>
      </div>

      {outcome === null ? null : <Note>{outcome}</Note>}
      {vendors.error === null ? null : <ErrorNote error={vendors.error} onRetry={vendors.reload} />}

      {vendors.data !== null && vendors.data.vendors.length === 0 && vendors.error === null ? (
        <Empty title={t("admin.vendors.empty.title")} body={t("admin.vendors.empty.body")} />
      ) : (
        <Table
          caption={t("admin.vendors.title")}
          head={
            <tr>
              <th scope="col">{t("admin.vendors.name")}</th>
              <th scope="col">{t("admin.vendors.statusColumn")}</th>
              <th scope="col">{t("admin.vendors.openState")}</th>
              <th scope="col">{t("admin.vendors.commission")}</th>
              <th scope="col">{t("admin.vendors.until")}</th>
              <th scope="col">{t("admin.cash.decide")}</th>
            </tr>
          }
        >
          {(vendors.data?.vendors ?? []).map((vendor) => (
            <tr key={vendor.id}>
              <td>
                <strong>{vendor.name}</strong>
                {vendor.nameBn === null ? null : <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{vendor.nameBn}</div>}
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{vendor.slug}</div>
              </td>
              <td>
                <Badge tone={vendor.status === "APPROVED" ? "success" : vendor.status === "SUSPENDED" || vendor.status === "REJECTED" ? "danger" : "neutral"}>
                  {vendor.status}
                </Badge>
              </td>
              <td>
                <Badge tone={openTone(vendor.openState)}>{vendor.openState}</Badge>
              </td>
              <AmountCell>{(vendor.commissionBps / 100).toFixed(2)}%</AmountCell>
              <td>{vendor.pausedUntil === null ? "—" : t.dateTime(vendor.pausedUntil, "day")}</td>
              <td>
                {vendor.status !== "APPROVED" ? (
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{t("admin.vendors.notApprovable")}</span>
                ) : vendor.openState === "PAUSED" ? (
                  <Button variant="secondary" onClick={() => void act(() => resumeVendor(token, vendor.id), "admin.vendors.resumed")}>
                    {t("admin.vendors.resume")}
                  </Button>
                ) : (
                  <Button onClick={() => setPausing(vendor)}>{t("admin.vendors.pause")}</Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {pausing === null ? null : (
        <PauseDialog
          vendor={pausing}
          onClose={() => setPausing(null)}
          onSubmit={(minutes, reason) => void act(() => pauseVendor(token, pausing.id, minutes, reason), "admin.vendors.paused")}
        />
      )}
    </>
  );
}

/** The pause dialog: how long, and why the owner will read. */
function PauseDialog({
  vendor,
  onClose,
  onSubmit,
}: {
  readonly vendor: AdminVendor;
  readonly onClose: () => void;
  readonly onSubmit: (minutes: number, reason: string) => void;
}): ReactNode {
  const t = useT();
  const [minutes, setMinutes] = useState<number>(30);
  const [reason, setReason] = useState("");
  const blocked = reason.trim().length < 3;

  return (
    <Dialog
      title={t("admin.vendors.pauseTitle")}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button disabled={blocked} onClick={() => onSubmit(minutes, reason.trim())}>
            {t("admin.vendors.pause")}
          </Button>
        </>
      }
    >
      <p>
        <strong>{vendor.name}</strong>
      </p>
      <Note>{t("admin.vendors.pauseWarning")}</Note>
      <Field id="pause-minutes" label={t("admin.vendors.duration")}>
        <Select
          id="pause-minutes"
          value={String(minutes)}
          onChange={(value) => setMinutes(Number(value))}
          options={PAUSE_MINUTES.map((value) => ({ value: String(value), label: t.minutes(value) }))}
        />
      </Field>
      <Field id="pause-reason" label={t("admin.vendors.reason")}>
        <TextArea id="pause-reason" value={reason} onChange={setReason} maxLength={128} />
      </Field>
      {blocked ? <p style={{ color: "var(--color-status-danger)", fontSize: 13 }}>{t("admin.cash.noteTooShort")}</p> : null}
    </Dialog>
  );
}

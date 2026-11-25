/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The audit register.
 *
 * Every other screen in this console asks the platform to do something. This one asks what it
 * already did — which is the question that arrives after a complaint, a mismatch in the cash box,
 * or a rider insisting they were suspended for no reason.
 *
 * The before/after is the point. A row saying `vendor.pause` tells a reviewer nothing they cannot
 * guess; the diff tells them the kitchen was open, is now closed until 22:40, and by whom. So the
 * table stays a table and the diff opens underneath it, one entry at a time.
 *
 * There is no edit and no delete here, and there never will be: the register is append-only, and a
 * console that could change it would make the whole chain decorative.
 */

import { useState, type ReactNode } from "react";

import { listAudit, type AuditEntry } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { Badge, Button, Empty, ErrorNote, Field, Select, Table } from "../components/kit.tsx";

/** How loud a row is, as the four severities the platform writes. */
const SEVERITIES = ["INFO", "NOTICE", "WARNING", "CRITICAL"] as const;

/** Who acted. */
const ACTORS = ["CUSTOMER", "VENDOR", "RIDER", "ADMIN", "SYSTEM"] as const;

/** The tone a severity earns. */
function severityTone(value: string): "neutral" | "live" | "warning" | "danger" {
  if (value === "CRITICAL") return "danger";
  if (value === "WARNING") return "warning";
  if (value === "NOTICE") return "live";
  return "neutral";
}

/** Pretty-print a diff half, or say there was nothing there. */
function half(value: unknown, absent: string): ReactNode {
  if (value === null || value === undefined) {
    return <span style={{ color: "var(--color-text-tertiary)" }}>{absent}</span>;
  }
  return (
    <pre
      style={{
        margin: 0,
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-sunken)",
        fontSize: 12,
        lineHeight: 1.45,
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The register screen. */
export function AuditPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const [severity, setSeverity] = useState<"ALL" | (typeof SEVERITIES)[number]>("ALL");
  const [actorType, setActorType] = useState<"ALL" | (typeof ACTORS)[number]>("ALL");
  const [action, setAction] = useState("");
  const [openSeq, setOpenSeq] = useState<number | null>(null);

  const register = useResource(
    async () =>
      listAudit(token, {
        ...(severity === "ALL" ? {} : { severity }),
        ...(actorType === "ALL" ? {} : { actorType }),
        ...(action.trim() === "" ? {} : { action: action.trim() }),
        limit: 50,
      }),
    [token, severity, actorType, action],
  );

  const entries = register.data?.entries ?? [];
  const open = entries.find((entry) => entry.seq === openSeq) ?? null;

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.audit.title")}</h1>
      <p style={{ maxWidth: "68ch", color: "var(--color-text-secondary)" }}>{t("admin.audit.intro")}</p>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field id="audit-severity" label={t("admin.audit.severity")}>
          <Select
            id="audit-severity"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "ALL" as const, label: t("admin.audit.anySeverity") },
              ...SEVERITIES.map((value) => ({ value, label: t(`admin.audit.severity.${value}` as never) })),
            ]}
          />
        </Field>
        <Field id="audit-actor" label={t("admin.audit.actor")}>
          <Select
            id="audit-actor"
            value={actorType}
            onChange={setActorType}
            options={[
              { value: "ALL" as const, label: t("admin.audit.anyActor") },
              ...ACTORS.map((value) => ({ value, label: t(`admin.audit.actor.${value}` as never) })),
            ]}
          />
        </Field>
        <Field id="audit-action" label={t("admin.audit.action")}>
          <input
            id="audit-action"
            type="search"
            spellCheck={false}
            aria-label={t("admin.audit.actionHint")}
            value={action}
            onChange={(event) => setAction(event.target.value)}
            style={{
              minHeight: "var(--layout-tap-target-min)",
              paddingInline: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg-surface)",
              fontFamily: "var(--font-family-mono)",
            }}
          />
        </Field>
        <Button variant="quiet" onClick={register.reload} busy={register.loading}>
          {t("action.retry")}
        </Button>
      </div>

      {register.error === null ? null : <ErrorNote error={register.error} onRetry={register.reload} />}

      {register.data !== null && entries.length === 0 && register.error === null ? (
        <Empty title={t("admin.audit.empty.title")} body={t("admin.audit.empty.body")} />
      ) : (
        <Table
          caption={t("admin.audit.title")}
          head={
            <tr>
              <th scope="col">{t("admin.audit.when")}</th>
              <th scope="col">{t("admin.audit.what")}</th>
              <th scope="col">{t("admin.audit.who")}</th>
              <th scope="col">{t("admin.audit.resource")}</th>
              <th scope="col">{t("admin.audit.why")}</th>
              <th scope="col">{t("admin.audit.detail")}</th>
            </tr>
          }
        >
          {entries.map((entry: AuditEntry) => (
            <tr key={entry.seq}>
              <td>
                {t.dateTime(entry.occurredAt, "day")}
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>#{entry.seq}</div>
              </td>
              <td>
                <code style={{ fontSize: 12 }}>{entry.action}</code>
                <div style={{ marginTop: 4 }}>
                  <Badge tone={severityTone(entry.severity)}>{entry.severity}</Badge>
                </div>
              </td>
              <td>
                {entry.actor.type}
                {entry.actor.role === null ? null : (
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{entry.actor.role}</div>
                )}
              </td>
              <td>
                {entry.resource.type}
                {entry.resource.id === null ? null : (
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontFamily: "var(--font-family-mono)" }}>
                    {entry.resource.id.slice(0, 8)}…
                  </div>
                )}
              </td>
              <td style={{ maxWidth: "32ch" }}>{entry.reason ?? "—"}</td>
              <td>
                <Button
                  variant="quiet"
                  onClick={() => setOpenSeq(openSeq === entry.seq ? null : entry.seq)}
                  aria-expanded={openSeq === entry.seq}
                >
                  {openSeq === entry.seq ? t("admin.audit.close") : t("admin.audit.open")}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {open === null ? null : (
        <section
          aria-label={t("admin.audit.diff")}
          style={{
            display: "grid",
            gap: "var(--space-3)",
            padding: "var(--space-4)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border-subtle)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <strong>
              #{open.seq} · <code>{open.action}</code>
            </strong>
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
              {t("admin.audit.request")}: {open.requestId ?? "—"}
            </span>
          </div>

          <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
            <div>
              <div style={{ marginBottom: "var(--space-2)", fontSize: 12, color: "var(--color-text-secondary)" }}>
                {t("admin.audit.before")}
              </div>
              {half(open.before, t("admin.audit.nothing"))}
            </div>
            <div>
              <div style={{ marginBottom: "var(--space-2)", fontSize: 12, color: "var(--color-text-secondary)" }}>
                {t("admin.audit.after")}
              </div>
              {half(open.after, t("admin.audit.nothing"))}
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", wordBreak: "break-all" }}>
            {t("admin.audit.chain")}: {open.prevHash === null ? "—" : `${open.prevHash.slice(0, 12)}…`} →{" "}
            {open.hash === null ? "—" : `${open.hash.slice(0, 12)}…`}
          </div>
        </section>
      )}
    </>
  );
}

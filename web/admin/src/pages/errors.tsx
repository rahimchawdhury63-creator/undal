/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The error register, as the platform defines it.
 *
 * A support agent reading a customer's screenshot needs three facts in this order: what the code
 * means in the customer's language, whether trying again can help, and what the payload carries.
 * All three are in `@undal/contracts` — the same table the Worker throws from — so this screen
 * renders the register rather than a copy of it. A console with its own list of error codes would
 * be a second source of truth, and the second one is always the wrong one.
 *
 * There is no request here and no permission: the register is public code, not data.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ERRORS, type ErrorCode } from "@undal/contracts";

import { useT } from "../lib/locale.tsx";
import { Badge, Empty, Field, Table } from "../components/kit.tsx";

/** Every code, alphabetically, built once at module load. */
const ALL_CODES = (Object.keys(ERRORS) as ErrorCode[]).sort((left, right) => left.localeCompare(right));

/** The statuses, for the filter, derived from the register itself. */
const STATUSES = [...new Set(ALL_CODES.map((code) => ERRORS[code].status))].sort((left, right) => left - right);

/** How a status reads: the client's problem, the server's, or the network's. */
function statusTone(status: number): "neutral" | "warning" | "danger" {
  if (status >= 500) return "danger";
  if (status >= 400 && status < 500) return "warning";
  return "neutral";
}

/** The error register. */
export function ErrorsPage(): ReactNode {
  const t = useT();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | number>("ALL");

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return ALL_CODES.filter((code) => {
      const definition = ERRORS[code];
      if (status !== "ALL" && definition.status !== status) return false;
      if (needle === "") return true;
      return (
        code.includes(needle) ||
        definition.en.toUpperCase().includes(needle) ||
        // A Bengali-speaking agent searches in Bengali; matching only the English copy would make
        // the box useless for half the staff.
        definition.bn.includes(query.trim())
      );
    });
  }, [query, status]);

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.errors.title")}</h1>
      <p style={{ maxWidth: "68ch", color: "var(--color-text-secondary)" }}>
        {t("admin.errors.intro")} {t.number(ALL_CODES.length)}
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field id="error-search" label={t("admin.errors.search")}>
          <input
            id="error-search"
            type="search"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
        <Field id="error-status" label={t("admin.errors.status")}>
          <select
            id="error-status"
            value={String(status)}
            onChange={(event) => setStatus(event.target.value === "ALL" ? "ALL" : Number(event.target.value))}
            style={{
              minHeight: "var(--layout-tap-target-min)",
              paddingInline: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg-surface)",
            }}
          >
            <option value="ALL">{t("admin.errors.anyStatus")}</option>
            {STATUSES.map((value) => (
              <option key={value} value={String(value)}>
                {String(value)}
              </option>
            ))}
          </select>
        </Field>
        <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
          {t("admin.errors.showing")} {t.number(rows.length)}
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty title={t("admin.errors.empty.title")} body={t("admin.errors.empty.body")} />
      ) : (
        <Table
          caption={t("admin.errors.title")}
          head={
            <tr>
              <th scope="col">{t("admin.errors.code")}</th>
              <th scope="col">{t("admin.errors.statusLabel")}</th>
              <th scope="col">{t("admin.errors.message")}</th>
              <th scope="col">{t("admin.errors.details")}</th>
              <th scope="col">{t("admin.errors.retry")}</th>
            </tr>
          }
        >
          {rows.map((code) => {
            const definition = ERRORS[code];
            return (
              <tr key={code}>
                <td>
                  <code style={{ fontSize: 12 }}>{code}</code>
                </td>
                <td>
                  <Badge tone={statusTone(definition.status)}>{String(definition.status)}</Badge>
                </td>
                <td style={{ maxWidth: "40ch" }}>
                  {definition.en}
                  <div lang="bn" style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
                    {definition.bn}
                  </div>
                </td>
                <td>
                  <code style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{definition.details}</code>
                </td>
                <td>
                  {definition.retryable ? (
                    <Badge tone="success">{t("admin.errors.retryable")}</Badge>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>{t("admin.errors.final")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}

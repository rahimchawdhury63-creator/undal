/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The system board: what the platform is configured to do right now.
 *
 * One table and one search box. The value column prints JSON because the values are models and
 * thresholds — a dispatch weight vector, a radius — and a screen that prettified them into prose
 * would be inventing a schema the platform does not have.
 *
 * A redacted row stays on the page. Hidden rows make a reviewer wonder whether the setting exists;
 * a row that says "redacted" answers that question and refuses the next one, which is the point.
 */

import { useState, type ReactNode } from "react";

import { listPlatformConfig, type ConfigEntry } from "../lib/system-api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { Badge, Button, Empty, ErrorNote, Field, Note, Table } from "../components/kit.tsx";

/** The system board. */
export function SystemPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const [prefix, setPrefix] = useState("");

  const config = useResource(
    async () => listPlatformConfig(token, { ...(prefix.trim() === "" ? {} : { prefix: prefix.trim() }), limit: 200 }),
    [token, prefix],
  );

  const entries = config.data?.entries ?? [];

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.system.title")}</h1>
      <p style={{ maxWidth: "68ch", color: "var(--color-text-secondary)" }}>{t("admin.system.intro")}</p>

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field id="config-prefix" label={t("admin.system.prefix")}>
          <input
            id="config-prefix"
            type="search"
            spellCheck={false}
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
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
        <Button variant="quiet" onClick={config.reload} busy={config.loading}>
          {t("action.retry")}
        </Button>
        {config.data === null ? null : (
          <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
            {t("admin.system.showing")} {t.number(entries.length)} / {t.number(config.data.totalKeys)}
          </span>
        )}
      </div>

      {config.error === null ? null : <ErrorNote error={config.error} onRetry={config.reload} />}

      {config.data !== null && entries.length === 0 && config.error === null ? (
        <Empty title={t("admin.system.empty.title")} body={t("admin.system.empty.body")} />
      ) : (
        <Table
          caption={t("admin.system.title")}
          head={
            <tr>
              <th scope="col">{t("admin.system.key")}</th>
              <th scope="col">{t("admin.system.value")}</th>
              <th scope="col">{t("admin.system.version")}</th>
              <th scope="col">{t("admin.system.effective")}</th>
              <th scope="col">{t("admin.system.reason")}</th>
            </tr>
          }
        >
          {entries.map((entry: ConfigEntry) => (
            <tr key={`${entry.key}:${entry.zoneId}`}>
              <td>
                <code>{entry.key}</code>
                <div style={{ marginTop: 4 }}>
                  <Badge tone={entry.scope === "GLOBAL" ? "neutral" : "live"}>{entry.scope}</Badge>
                </div>
              </td>
              <td style={{ maxWidth: "44ch" }}>
                {entry.redacted ? (
                  <Badge tone="warning">{t("admin.system.redacted")}</Badge>
                ) : (
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.4,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "var(--font-family-mono)",
                    }}
                  >
                    {JSON.stringify(entry.value, null, 2)}
                  </pre>
                )}
              </td>
              <td>
                <code style={{ fontSize: 12 }}>{entry.version}</code>
              </td>
              <td>{t.dateTime(entry.effectiveAt, "day")}</td>
              <td style={{ maxWidth: "28ch" }}>{entry.reason}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note>{t("admin.system.note")}</Note>
    </>
  );
}

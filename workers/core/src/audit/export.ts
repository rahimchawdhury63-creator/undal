/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { toCsv } from "../lib/csv.ts";
import type { Db } from "../db/client.ts";
import { fromSqlDateTime } from "../lib/time.ts";

import type { AuditEntry } from "./types.ts";

/**
 * The audit export: a CSV of a date range, for a regulator, an auditor or a subject access
 * request.
 *
 * Two constraints shape it. It is streamed in pages, because an export of a year of audit
 * rows will not fit in a Worker's memory; and it is written through `toCsv`, so a reason
 * field beginning with `=` cannot become a formula in the recipient's spreadsheet.
 */

/** Rows per page. Matches the verification batch, for the same reason. */
export const EXPORT_BATCH = 1_000;

/** The columns of the export, in the order an auditor reads them. */
export const EXPORT_COLUMNS = [
  "seq",
  "occurred_at",
  "actor_type",
  "actor_role",
  "action",
  "resource_type",
  "resource_id",
  "reason",
  "severity",
  "request_id",
  "hash",
] as const;

/** The row shape the export reads. */
interface ExportRow {
  readonly seq: number | string;
  readonly occurred_at: string;
  readonly actor_type: string;
  readonly actor_role: string | null;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly reason: string | null;
  readonly severity: string;
  readonly request_id: Uint8Array;
  readonly hash: Uint8Array;
}

/**
 * Export a range as CSV text.
 *
 * The upper bound is exclusive so that consecutive exports cannot both contain the row on
 * the boundary — an auditor reconciling two files finds a double-count otherwise, and blames
 * the ledger.
 */
export async function exportAuditCsv(
  db: Db,
  input: { fromIso: string; toIso: string; batchSize?: number },
): Promise<string> {
  const batchSize = input.batchSize ?? EXPORT_BATCH;
  const rows: (readonly (string | number | null)[])[] = [];
  let cursor = 1;

  for (;;) {
    const page = await db.query<ExportRow>(
      "SELECT `seq`, `occurred_at`, `actor_type`, `actor_role`, `action`, `resource_type`, `resource_id`, `reason`, " +
        "`severity`, `request_id`, `hash` FROM `audit_log` " +
        "WHERE `occurred_at` >= ? AND `occurred_at` < ? AND `seq` >= ? ORDER BY `seq` ASC LIMIT ?",
      [input.fromIso, input.toIso, cursor, batchSize],
    );
    if (page.length === 0) break;
    for (const row of page) {
      rows.push([
        Number(row.seq),
        row.occurred_at,
        row.actor_type,
        row.actor_role,
        row.action,
        row.resource_type,
        row.resource_id,
        row.reason,
        row.severity,
        hex(row.request_id),
        hex(row.hash),
      ]);
    }
    if (page.length < batchSize) break;
    cursor = Number(page[page.length - 1]?.seq ?? cursor) + 1;
  }

  return toCsv(EXPORT_COLUMNS, rows);
}

/**
 * The bundle an export carries: the CSV plus the chain head it started from.
 *
 * A CSV with no chain evidence proves nothing about tampering; the head hash lets a recipient
 * verify the file against the live chain without being given the whole database.
 */
export interface AuditExport {
  readonly csv: string;
  readonly rows: number;
  readonly fromIso: string;
  readonly toIso: string;
  readonly headHashHex: string | null;
}

/** Build the export bundle. */
export async function buildAuditExport(db: Db, fromIso: string, toIso: string): Promise<AuditExport> {
  const csv = await exportAuditCsv(db, { fromIso, toIso });
  const last = await db.first<{ hash: Uint8Array | null; seq: number | string }>(
    "SELECT `hash`, `seq` FROM `audit_log` WHERE `occurred_at` < ? ORDER BY `seq` DESC LIMIT 1",
    [toIso],
  );
  return {
    csv,
    rows: csv.split("\r\n").filter((line) => line !== "").length - 1,
    fromIso,
    toIso,
    headHashHex: last === null || last.hash === null ? null : hex(new Uint8Array(last.hash)),
  };
}

/** Bytes as lowercase hex. */
function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The timestamp an export range starts from, given a Dhaka date and an offset in days. */
export function isoRange(from: Date, to: Date): { fromIso: string; toIso: string } {
  const format = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
  return { fromIso: format(from), toIso: format(to) };
}

/** A stored `DATETIME(6)` as an ISO instant, for the export's metadata. */
export function isoOf(entry: AuditEntry): string {
  return fromSqlDateTime(entry.occurredAt).toISOString();
}

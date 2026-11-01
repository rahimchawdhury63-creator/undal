/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * CSV for exports, written the way a spreadsheet reads it and the way a reviewer
 * of a data export needs it to be safe.
 *
 * Undal exports invoices, payouts and personal-data subject reports. Two details
 * decide whether the file is usable: a UTF-8 BOM so Bangla renders in Excel rather
 * than as mojibake, and formula-injection escaping so a vendor named `=cmd|...`
 * cannot execute in the accounting department's spreadsheet.
 */

const NEEDS_QUOTING = /[",\r\n]/u;
const FORMULA_LEAD = /^[=+\-@\t\r]/u;

/**
 * One cell, quoted if it contains a separator, a quote or a newline.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with a single quote: spreadsheets
 * interpret those as formulas, and a customer's name is not a formula. The value
 * inside the quotes is otherwise unchanged, so a numeric column still parses.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return NEEDS_QUOTING.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded;
}

/** A full document: the header row, then one line per record, CRLF-terminated. */
export function toCsv(columns: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * The same document with the BOM Excel needs to detect UTF-8.
 *
 * Returned separately from `toCsv` so a test can assert the bytes, and so a caller
 * writing to a system that already declares its encoding can skip it.
 */
export function toCsvDownload(columns: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  return `\uFEFF${toCsv(columns, rows)}`;
}

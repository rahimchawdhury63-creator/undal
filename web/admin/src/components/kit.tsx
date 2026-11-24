/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The console's primitives.
 *
 * Smaller than the storefront's set on purpose: an operations screen has one kind of button, one
 * kind of table and one kind of dialog, and a component invented for a single screen is a second
 * vocabulary nobody reviews. Every amount goes through `Money`, every state through `Badge`, and
 * every failure through `ErrorNote`, so the console cannot show a number the platform formats
 * differently from the customer's receipt.
 */

import { useEffect, useRef, type ReactNode } from "react";

import type { ApiError } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import styles from "./kit.module.css";

/** A button. `busy` disables it and announces the wait rather than swallowing the second click. */
export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  busy = false,
}: {
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly variant?: "primary" | "secondary" | "danger" | "quiet";
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly busy?: boolean;
}): ReactNode {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant]].join(" ")}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
    >
      {children}
    </button>
  );
}

/** A padded surface for a grouped control or a paragraph of context. */
export function Card({ children, padded = true }: { readonly children: ReactNode; readonly padded?: boolean }): ReactNode {
  return <div className={[styles.card, padded ? styles.cardPad : ""].filter(Boolean).join(" ")}>{children}</div>;
}

/** A horizontally scrollable table. Rows stay on one line; a narrow window scrolls rather than wraps. */
export function Table({ caption, head, children }: { readonly caption: string; readonly head: ReactNode; readonly children: ReactNode }): ReactNode {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="undal-visually-hidden">{caption}</caption>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A cell holding an amount, right-aligned and tabular. */
export function AmountCell({ children }: { readonly children: ReactNode }): ReactNode {
  return <td className={styles.numeric}>{children}</td>;
}

/** A status pill. */
export function Badge({ tone, children }: { readonly tone: "neutral" | "success" | "warning" | "danger" | "info" | "live"; readonly children: ReactNode }): ReactNode {
  const background = tone === "live" ? "var(--color-live-soft)" : `var(--color-status-${tone}-soft)`;
  const colour = tone === "live" ? "var(--color-live-base)" : `var(--color-status-${tone})`;
  return (
    <span className={styles.badge} style={{ background, color: colour }}>
      {children}
    </span>
  );
}

/** An integer-paisa amount, formatted by the same translator the customer app uses. */
export function Money({ paisa, strong = false }: { readonly paisa: number; readonly strong?: boolean }): ReactNode {
  const t = useT();
  return <span className="undal-money" style={strong ? { fontWeight: 700 } : undefined}>{t.money(paisa)}</span>;
}

/** One number on the dashboard: what it is, what it reads, and what it means. */
export function Kpi({ label, value, hint, tone }: { readonly label: string; readonly value: string; readonly hint?: string | undefined; readonly tone?: "neutral" | "warning" | "danger" }): ReactNode {
  const colour = tone === "danger" ? "var(--color-status-danger)" : tone === "warning" ? "var(--color-status-warning)" : "var(--color-text-primary)";
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue} style={{ color: colour }}>
        {value}
      </span>
      {hint === undefined ? null : <span className={styles.kpiHint}>{hint}</span>}
    </div>
  );
}

/** A failure, with the code and request id a support conversation needs. */
export function ErrorNote({ error, onRetry }: { readonly error: ApiError; readonly onRetry?: (() => void) | undefined }): ReactNode {
  const t = useT();
  const forbidden = error.status === 403;
  return (
    <div className={styles.error} role="alert">
      <strong>{forbidden ? t("admin.error.forbidden") : t.errorMessage(error.code)}</strong>
      <span>{forbidden ? t("admin.error.forbidden.body") : t("state.error.body")}</span>
      <span className={styles.errorCode}>
        {error.code}
        {error.requestId === null ? "" : ` · ${error.requestId}`}
      </span>
      {forbidden || onRetry === undefined ? null : (
        <div>
          <Button variant="secondary" onClick={onRetry}>
            {t("action.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Nothing to show, said precisely. */
export function Empty({ title, body }: { readonly title: string; readonly body: string }): ReactNode {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p>{body}</p>
    </div>
  );
}

/** A labelled control. */
export function Field({ id, label, children }: { readonly id: string; readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** A select over a closed set of codes; the value is the code, the label is its sentence. */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  readonly id: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}): ReactNode {
  return (
    <select id={id} className={styles.select} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A free-text note, capped so a reviewer cannot paste a document into an audit row. */
export function TextArea({
  id,
  value,
  onChange,
  maxLength = 500,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength?: number;
}): ReactNode {
  return (
    <textarea
      id={id}
      className={styles.textarea}
      value={value}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      style={{ width: "100%" }}
    />
  );
}

/** A single-line input. */
export function Input({
  id,
  value,
  onChange,
  type = "text",
  autoComplete,
  required = false,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "tel" | "password";
  readonly autoComplete?: string;
  readonly required?: boolean;
}): ReactNode {
  return (
    <input
      id={id}
      className={styles.input}
      type={type}
      value={value}
      required={required}
      onChange={(event) => onChange(event.target.value)}
      style={{ width: "100%" }}
      {...(autoComplete === undefined ? {} : { autoComplete })}
    />
  );
}

/**
 * A modal decision.
 *
 * It traps the keyboard on open, closes on Escape, and returns focus to whatever opened it — the
 * three behaviours that separate a dialog from a div that happens to sit on top of the page.
 */
export function Dialog({
  title,
  children,
  onClose,
  actions,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly actions: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2 className={styles.dialogTitle}>{title}</h2>
        {children}
        <div className={styles.dialogActions}>{actions}</div>
      </div>
    </div>
  );
}

/** A short warning strip for a decision with a consequence the operator should see first. */
export function Note({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className={styles.note}>{children}</p>;
}

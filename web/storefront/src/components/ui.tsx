/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The primitives every screen is built from.
 *
 * Each one is the smallest thing that can be right: a button that is a real `<button>` with a
 * 44 px target, a field whose label is bound by id and whose error is bound by
 * `aria-describedby`, an empty state that always says what happened and what to do. None of them
 * read a raw colour, duration or string — the token engine and the catalogue own those.
 */

import type { CSSProperties, ReactNode } from "react";

import styles from "./ui.module.css";

/** The button's visual weight. There is one filled primary per screen (03 §2.2). */
export type ButtonVariant = "primary" | "secondary" | "brand" | "ghost" | "danger";

/** A button that behaves like a button and never like a div. */
export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  busy = false,
  ariaLabel,
  fullWidth = false,
}: {
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly variant?: ButtonVariant;
  readonly size?: "sm" | "md";
  readonly type?: "button" | "submit";
  readonly disabled?: boolean | undefined;
  readonly busy?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly fullWidth?: boolean | undefined;
}): ReactNode {
  const classes = [styles.button, styles[variant], size === "sm" ? styles.small : ""].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
      {...(fullWidth ? { style: { width: "100%" } } : {})}
    >
      {children}
    </button>
  );
}

/** A surface for one thing: a vendor, a cart, an order. */
export function Card({
  children,
  className,
  style,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}): ReactNode {
  return (
    <div className={[styles.card, className ?? ""].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}

/** A grouping panel: the `#F4F4F2` block that separates sections without a border. */
export function Panel({
  children,
  className,
  style,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}): ReactNode {
  return (
    <section className={[styles.panel, className ?? ""].filter(Boolean).join(" ")} style={style}>
      {children}
    </section>
  );
}

/** A vertical stack with the platform's default rhythm. */
export function Stack({ children, gap = 4, className }: { readonly children: ReactNode; readonly gap?: 2 | 3 | 4 | 6; readonly className?: string | undefined }): ReactNode {
  return (
    <div className={[styles.stack, className ?? ""].filter(Boolean).join(" ")} style={{ gap: `var(--space-${gap})` }}>
      {children}
    </div>
  );
}

/** A horizontal row that wraps rather than overflowing at 200 px. */
export function Row({
  children,
  className,
  style,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}): ReactNode {
  return (
    <div className={[styles.row, className ?? ""].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}

/** Two things at opposite ends, which is most headers. */
export function Between({ children, className }: { readonly children: ReactNode; readonly className?: string | undefined }): ReactNode {
  return <div className={[styles.between, className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

/** A filter chip that reports its pressed state to assistive technology. */
export function Chip({
  children,
  active = false,
  onClick,
}: {
  readonly children: ReactNode;
  readonly active?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
}): ReactNode {
  return (
    <button type="button" className={styles.chip} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

/** A small coloured status label. The colour comes from the caller's token, never from here. */
export function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "success" | "warning" | "danger" | "info" | "live";
}): ReactNode {
  const background = tone === "live" ? "var(--color-live-soft)" : `var(--color-status-${tone}-soft)`;
  const colour = tone === "live" ? "var(--color-live-base)" : `var(--color-status-${tone})`;
  return (
    <span className={styles.badge} style={{ background, color: colour }}>
      {children}
    </span>
  );
}

/** A labelled form control with its error wired to the input by id. */
export function Field({
  id,
  label,
  children,
  hint,
  error,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string | undefined;
  readonly error?: string | null;
}): ReactNode {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {error !== undefined && error !== null ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : hint === undefined ? null : (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** A single-line text input. */
export function Input({
  id,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  required = false,
  describedBy,
  disabled = false,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "tel" | "password" | "email" | "number";
  readonly autoComplete?: string | undefined;
  readonly inputMode?: "text" | "tel" | "numeric" | "decimal" | "email";
  readonly required?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  return (
    <input
      id={id}
      className={styles.input}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      disabled={disabled}
      {...(autoComplete === undefined ? {} : { autoComplete })}
      {...(inputMode === undefined ? {} : { inputMode })}
      {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
    />
  );
}

/** A text area for the kitchen note and delivery instructions. */
export function TextArea({
  id,
  value,
  onChange,
  rows = 3,
  maxLength,
  describedBy,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly describedBy?: string | undefined;
}): ReactNode {
  return (
    <textarea
      id={id}
      className={styles.input}
      value={value}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      {...(maxLength === undefined ? {} : { maxLength })}
      {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
      style={{ paddingBlock: "var(--space-3)", resize: "vertical" }}
    />
  );
}

/** A section heading with an optional trailing action. */
export function SectionTitle({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode | undefined;
}): ReactNode {
  return (
    <Between>
      <h2 className={styles.sectionTitle}>{children}</h2>
      {action ?? null}
    </Between>
  );
}

/** A shimmering block shown while a page's data is on its way. */
export function Skeleton({ height = 96, style }: { readonly height?: number | undefined; readonly style?: CSSProperties }): ReactNode {
  return <div className={styles.skeleton} style={{ height, ...style }} aria-hidden="true" />;
}

/** A hairline rule. */
export function Divider(): ReactNode {
  return <hr className={styles.divider} />;
}

/** Text that only a screen reader reads, for a state a visual change implies. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className={styles.srOnly}>{children}</span>;
}

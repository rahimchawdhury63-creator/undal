/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Empty, error and offline states.
 *
 * The empty-state doctrine (`docs/33`) is that a platform with no data should say so beautifully
 * and precisely, because on day one that is the whole storefront: no vendors, no orders, no
 * riders. So an empty state here always names the thing that is missing, says why, and offers one
 * action. An error state does the same for a failure, and never blames the person reading it.
 */

import type { ReactNode } from "react";

import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { Button, Card, Stack } from "./ui.tsx";
import styles from "./states.module.css";

/** The illustration slot: a token-coloured disc with an icon, so an empty page is not a void. */
function Artwork({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className={styles.artwork} aria-hidden="true">
      {children}
    </div>
  );
}

/** Nothing here yet, and that is a fact rather than a failure. */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  to,
  artwork,
  compact = false,
}: {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly to?: string;
  readonly artwork?: ReactNode;
  readonly compact?: boolean;
}): ReactNode {
  return (
    <Card className={compact ? styles.compact : styles.wide}>
      <div className={styles.inner}>
        <Artwork>{artwork ?? <DefaultArtwork />}</Artwork>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        {actionLabel === undefined ? null : to === undefined ? (
          <Button onClick={onAction}>{actionLabel}</Button>
        ) : (
          <a className={styles.linkButton} href={to}>
            {actionLabel}
          </a>
        )}
      </div>
    </Card>
  );
}

/** The default mark: a plate with a fork, drawn rather than imported. */
function DefaultArtwork(): ReactNode {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <circle cx="24" cy="24" r="15" />
      <path d="M18 15v8a3 3 0 0 0 6 0v-8M21 15v18" />
      <path d="M30 15c2 2 3 5 3 8s-1 4-3 4v6" />
    </svg>
  );
}

/**
 * A failure, described in the customer's language.
 *
 * The code is shown only in the diagnostic affordance, never as the explanation: "we could not
 * reach Undal" is what a person needs, and `NETWORK` is what a support agent needs. Both are here;
 * only one is shouted.
 */
export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  readonly error: ApiError;
  readonly onRetry?: () => void;
  readonly compact?: boolean;
}): ReactNode {
  const t = useT();
  const unreachable = error.code === "NETWORK" || error.code === "ABORTED";
  const title = unreachable ? t("state.error.title") : t.errorMessage(error.code);
  const body = unreachable ? t("error.network") : t("state.error.body");
  return (
    <Card className={compact ? styles.compact : styles.wide}>
      <div className={styles.inner}>
        <Artwork>
          <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M24 6 4 42h40L24 6Z" />
            <path d="M24 19v10M24 34v.2" />
          </svg>
        </Artwork>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <Stack gap={2}>
          {onRetry === undefined ? null : <Button onClick={onRetry}>{t("action.retry")}</Button>}
          <details className={styles.details}>
            <summary className={styles.summary}>{t("state.error.diagnostic")}</summary>
            <pre className={styles.pre}>
              {error.code}
              {error.requestId === null ? "" : `\nrequest: ${error.requestId}`}
            </pre>
          </details>
        </Stack>
      </div>
    </Card>
  );
}

/** A dismissible notice that ordering is paused while the connection is down. */
export function OfflineBanner({ online }: { readonly online: boolean }): ReactNode {
  const t = useT();
  if (online) return null;
  return (
    <div className={styles.offline} role="status">
      {t("state.offlineBanner")}
    </div>
  );
}

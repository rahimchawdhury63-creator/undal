/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * A route that does not exist, said without a stack trace.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

import { Card } from "../components/kit.tsx";
import { useT } from "../lib/locale.tsx";

/** The 404. */
export function NotFoundPage(): ReactNode {
  const t = useT();
  return (
    <Card>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("page.404.title")}</h1>
      <p style={{ color: "var(--color-text-secondary)", marginBlock: "var(--space-2)" }}>{t("page.404.body")}</p>
      <Link to="/" style={{ color: "var(--color-action-primary-press)", fontWeight: 600 }}>
        {t("admin.domain.orders")}
      </Link>
    </Card>
  );
}

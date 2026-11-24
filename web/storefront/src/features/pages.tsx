/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The pages that are words rather than data: the licence, the policies, how to join, and the two
 * consoles that explain what a browser can and cannot do.
 *
 * Each one is a real page with a real body. Where the platform cannot yet do something through the
 * browser — publishing a menu, going online as a rider — the page says so and sends the person to
 * the Android app, because a button that 404s is worse than an honest sentence.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

import { useT } from "../lib/locale.tsx";
import { Button, Card, Panel, Row, SectionTitle } from "../components/ui.tsx";
import { WarningIcon } from "../components/icons.tsx";
import styles from "./feature.module.css";

/** The identifiers a static page can have. */
export type StaticPageId = "about" | "help" | "contact" | "privacy" | "terms" | "licence" | "app" | "joinRestaurant" | "joinRider" | "partner" | "rider";

/** A static page: a title, a lead paragraph and a list of titled paragraphs. */
export function StaticPage({ id }: { readonly id: StaticPageId }): ReactNode {
  const t = useT();
  const key = `page.${id}` as const;
  const sections: readonly number[] = [1, 2, 3, 4];
  return (
    <div className={styles.page}>
      <div className="undal-reading">
        <h1 className={styles.vendorTitle}>{t(`${key}.title` as never)}</h1>
        <p className={styles.muted} style={{ marginBlock: "var(--space-3)" }}>
          {t(`${key}.lead` as never)}
        </p>
        {sections.map((index) => (
          <Panel key={index} className={styles.section}>
            <SectionTitle>{t(`${key}.s${index}.title` as never)}</SectionTitle>
            <p className={styles.muted} style={{ marginBlockStart: "var(--space-2)" }}>
              {t(`${key}.s${index}.body` as never)}
            </p>
          </Panel>
        ))}
        <div style={{ marginBlockStart: "var(--space-6)" }}>
          <Link to="/">
            <Button variant="secondary">{t("cart.empty.action")}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The partner console.
 *
 * The API behind it exists and is permission-checked; the browser client for it is the admin
 * application, not this storefront, so this page is a doorway rather than a duplicate.
 */
export function PartnerPage(): ReactNode {
  const t = useT();
  return (
    <div className={styles.page}>
      <div className="undal-reading">
        <h1 className={styles.vendorTitle}>{t("page.partner.title")}</h1>
        <p className={styles.muted} style={{ marginBlock: "var(--space-3)" }}>
          {t("page.partner.lead")}
        </p>
        <Panel>
          <SectionTitle>{t("page.partner.s1.title")}</SectionTitle>
          <p className={styles.muted} style={{ marginBlockStart: "var(--space-2)" }}>
            {t("page.partner.s1.body")}
          </p>
          <div className={styles.notice} style={{ marginBlockStart: "var(--space-4)" }}>
            <WarningIcon size={20} />
            <span>{t("page.partner.notice")}</span>
          </div>
          <Row style={{ marginBlockStart: "var(--space-4)" }}>
            <Link to="/join/restaurant">
              <Button>{t("join.restaurant.title")}</Button>
            </Link>
            <Link to="/help">
              <Button variant="secondary">{t("page.help.title")}</Button>
            </Link>
          </Row>
        </Panel>
      </div>
    </div>
  );
}

/** The rider console's doorway, on the same terms as the partner console. */
export function RiderPage(): ReactNode {
  const t = useT();
  return (
    <div className={styles.page}>
      <div className="undal-reading">
        <h1 className={styles.vendorTitle}>{t("page.rider.title")}</h1>
        <p className={styles.muted} style={{ marginBlock: "var(--space-3)" }}>
          {t("page.rider.lead")}
        </p>
        <Panel>
          <SectionTitle>{t("page.rider.s1.title")}</SectionTitle>
          <p className={styles.muted} style={{ marginBlockStart: "var(--space-2)" }}>
            {t("page.rider.s1.body")}
          </p>
          <div className={styles.notice} style={{ marginBlockStart: "var(--space-4)" }}>
            <WarningIcon size={20} />
            <span>{t("page.rider.notice")}</span>
          </div>
          <Row style={{ marginBlockStart: "var(--space-4)" }}>
            <Link to="/join/rider">
              <Button>{t("join.rider.title")}</Button>
            </Link>
          </Row>
        </Panel>
      </div>
    </div>
  );
}

/** A page that is not here, which says so and offers the two useful ways back. */
export function NotFoundPage(): ReactNode {
  const t = useT();
  return (
    <div className={styles.page}>
      <Card>
        <div style={{ padding: "var(--space-10)", textAlign: "center", display: "grid", gap: "var(--space-3)" }}>
          <p className={styles.heroTitle} style={{ marginInline: "auto" }}>
            404
          </p>
          <h1 className={styles.sectionHeading} style={{ position: "static", background: "none" }}>
            {t("state.notFound.title")}
          </h1>
          <p className={styles.muted}>{t("state.notFound.body")}</p>
          <Row style={{ justifyContent: "center" }}>
            <Link to="/">
              <Button>{t("cart.empty.action")}</Button>
            </Link>
            <Link to="/help">
              <Button variant="secondary">{t("page.help.title")}</Button>
            </Link>
          </Row>
        </div>
      </Card>
    </div>
  );
}

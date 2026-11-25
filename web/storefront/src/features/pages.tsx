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

import type { MessageKey } from "@undal/i18n";

import { useT } from "../lib/locale.tsx";
import { Button, Card, Panel, Row, SectionTitle } from "../components/ui.tsx";
import { WarningIcon } from "../components/icons.tsx";
import styles from "./feature.module.css";

/** The identifiers a static page can have. */
export type StaticPageId =
  | "about"
  | "help"
  | "contact"
  | "privacy"
  | "terms"
  | "licence"
  | "app"
  | "joinRestaurant"
  | "joinRider";

/** One titled paragraph of a static page. */
interface Section {
  readonly title: MessageKey;
  readonly body: MessageKey;
}

/** What a static page says, as catalogue keys rather than sentences, so both locales exist. */
interface StaticContent {
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly sections: readonly Section[];
}

/**
 * The nine static pages, each as keys.
 *
 * Only the pages whose content is genuinely sectional get sections; a help page with four invented
 * headings to fill a template is worse than a help page with three honest ones.
 */
const CONTENT: Record<StaticPageId, StaticContent> = {
  about: { title: "page.about.title", body: "page.about.body", sections: [] },
  help: {
    title: "page.help.title",
    body: "page.help.body",
    sections: [
      { title: "page.help.s1.title", body: "page.help.s1.body" },
      { title: "page.help.s2.title", body: "page.help.s2.body" },
      { title: "page.help.s3.title", body: "page.help.s3.body" },
    ],
  },
  contact: { title: "page.contact.title", body: "page.contact.body", sections: [] },
  privacy: {
    title: "page.privacy.title",
    body: "page.privacy.body",
    sections: [
      { title: "page.privacy.s1.title", body: "page.privacy.s1.body" },
      { title: "page.privacy.s2.title", body: "page.privacy.s2.body" },
      { title: "page.privacy.s3.title", body: "page.privacy.s3.body" },
    ],
  },
  terms: {
    title: "page.terms.title",
    body: "page.terms.body",
    sections: [
      { title: "page.terms.s1.title", body: "page.terms.s1.body" },
      { title: "page.terms.s2.title", body: "page.terms.s2.body" },
      { title: "page.terms.s3.title", body: "page.terms.s3.body" },
    ],
  },
  licence: { title: "page.licence.title", body: "page.licence.body", sections: [] },
  app: { title: "page.app.title", body: "page.app.body", sections: [] },
  joinRestaurant: { title: "join.restaurant.title", body: "join.restaurant.body", sections: [] },
  joinRider: { title: "join.rider.title", body: "join.rider.body", sections: [] },
};

/** A static page: a title, a lead paragraph and its sections. */
export function StaticPage({ id }: { readonly id: StaticPageId }): ReactNode {
  const t = useT();
  const content = CONTENT[id];
  return (
    <div className={styles.page}>
      <div className="undal-reading">
        <h1 className={styles.vendorTitle}>{t(content.title)}</h1>
        <p className={styles.muted} style={{ marginBlock: "var(--space-3)" }}>
          {t(content.body)}
        </p>
        {content.sections.map((section) => (
          <Panel key={section.title}>
            <SectionTitle>{t(section.title)}</SectionTitle>
            <p className={styles.muted} style={{ marginBlockStart: "var(--space-2)" }}>
              {t(section.body)}
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
            {t("page.404.title")}
          </h1>
          <p className={styles.muted}>{t("page.404.body")}</p>
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

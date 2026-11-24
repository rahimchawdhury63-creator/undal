/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The console's frame: navigation, the person, and the way out.
 *
 * The navigation carries the queue counts, because the first question a reviewer asks is "how many
 * are waiting for me" and answering it with a second click is a queue that gets checked less often
 * than it should. Below 1024 px the sidebar becomes a strip along the top rather than a drawer: an
 * operations screen opened on a phone during an incident should not need a hamburger to reach the
 * money.
 */

import { NavLink, Outlet } from "react-router";
import type { ReactNode } from "react";

import { useCounts } from "../lib/counts.ts";
import { useLocale, useSetLocale, useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { Button } from "./kit.tsx";
import styles from "./shell.module.css";

/** The frame around every signed-in screen. */
export function Shell(): ReactNode {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const settlementsWaiting = useCounts((state) => state.settlementsWaiting);
  const declarationsOpen = useCounts((state) => state.declarationsOpen);

  const link = (to: string, label: string, count?: number) => (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) => [styles.navLink, isActive ? styles.navLinkActive : ""].filter(Boolean).join(" ")}
    >
      {label}
      {count === undefined || count === 0 ? null : <span className={styles.count}>{count}</span>}
    </NavLink>
  );

  return (
    <div className={styles.frame}>
      <aside className={styles.sidebar}>
        <div>
          <p className={styles.brand}>
            Undal
            <span className={styles.brandDot} aria-hidden="true" />
          </p>
          <p className={styles.brandSub}>{t("admin.title")}</p>
        </div>
        <nav className={styles.nav} aria-label={t("admin.title")}>
          {link("/", t("admin.domain.orders"))}
          {link("/cash/settlements", t("admin.cash.title"), settlementsWaiting ?? undefined)}
          {link("/cash/declarations", t("admin.exceptions"), declarationsOpen ?? undefined)}
          {link("/vendors", t("admin.vendors.title"))}
          {link("/fleet", t("admin.fleet.title"))}
          {link("/zones", t("admin.zones.title"))}
          {link("/growth", t("admin.growth.title"))}
          {link("/audit", t("admin.audit.title"))}
          {link("/orders", t("admin.orders.title"))}
        </nav>
        <div className={styles.sidebarFoot}>
          <span>{t("admin.role")}: {user?.role ?? "—"}</span>
          <span>{user?.phone ?? user?.userId ?? ""}</span>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.langButton}
            onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
            aria-label={t("nav.language")}
          >
            {locale === "bn" ? "EN" : "বাং"}
          </button>
          <div className={styles.grow} />
          <Button variant="quiet" onClick={() => void signOut()}>
            {t("admin.signOut")}
          </Button>
        </header>
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

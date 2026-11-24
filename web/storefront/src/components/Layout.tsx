/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The frame every page sits in: header, footer, cart capsule and the offline banner.
 *
 * The header carries the four things a customer needs from any page — where they are, how to
 * search, the language, and the cart — and it collapses honestly: below 200 px the wordmark
 * becomes a mark, the area label disappears, and the search field keeps its full width because
 * a search box that shrinks to an icon at small sizes is a search box nobody can type in.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { itemCount, subtotalPaisa, useCart } from "../lib/cart.ts";
import { pick, useLocale, useT } from "../lib/locale.tsx";
import { usePrefs } from "../lib/prefs.ts";
import { otherLocale } from "@undal/i18n";
import { CartIcon, SearchIcon, UserIcon } from "./icons.tsx";
import { Money } from "./Money.tsx";
import { OfflineBanner } from "./states.tsx";
import styles from "./layout.module.css";

/** An area as the header's selector needs it. */
export interface HeaderArea {
  readonly slug: string;
  readonly name: string;
  readonly nameBn: string;
}

/** The header, the page slot and the footer. */
export function Layout({
  children,
  areas,
}: {
  readonly children: ReactNode;
  readonly areas: readonly HeaderArea[];
}): ReactNode {
  const t = useT();
  const locale = useLocale();
  const lines = useCart((state) => state.lines);
  const areaSlug = usePrefs((state) => state.area);
  const setArea = usePrefs((state) => state.setArea);
  const theme = usePrefs((state) => state.theme);
  const setTheme = usePrefs((state) => state.setTheme);
  const setLocale = usePrefs((state) => state.setLocale);
  const location = useLocation();
  const [query, setQuery] = useState("");
  const online = useOnline();

  useEffect(() => {
    if (areas.length > 0 && areaSlug === null) setArea(areas[0]?.slug ?? null);
  }, [areas, areaSlug, setArea]);

  const area = areas.find((candidate) => candidate.slug === areaSlug) ?? areas[0] ?? null;
  const count = itemCount(lines);
  const total = subtotalPaisa(lines);

  return (
    <div className="undal-page">
      <a className="undal-skip-link" href="#main">
        {t("nav.skipToContent")}
      </a>
      <OfflineBanner online={online} />
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.wordmark} aria-label={t("app.name")}>
            {locale === "bn" ? "উন্ডাল" : "undal"}
            <span className={styles.wordmarkMark} aria-hidden="true" />
          </Link>

          <Link to="/" className={styles.areaButton} aria-label={t("home.location.change")}>
            <span className={styles.areaText}>{area === null ? t("home.location.unknown") : pick(locale, area.name, area.nameBn)}</span>
          </Link>

          <form
            className={styles.searchForm}
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const target = `/search?q=${encodeURIComponent(query)}`;
              window.location.assign(target);
            }}
          >
            <label className="undal-visually-hidden" htmlFor="site-search">
              {t("action.search")}
            </label>
            <input
              id="site-search"
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            <button type="submit" className={styles.iconButton} aria-label={t("action.search")}>
              <SearchIcon />
            </button>
          </form>

          <nav className={styles.nav} aria-label={t("nav.menu")}>
            <Link to="/account" className={styles.navLink}>
              {t("nav.orders")}
            </Link>
            <Link to="/partner" className={styles.navLink}>
              {t("nav.partner")}
            </Link>
          </nav>

          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setLocale(otherLocale(locale))}
            aria-label={t("nav.language")}
            title={t("nav.language")}
          >
            <span aria-hidden="true">{locale === "bn" ? "EN" : "বাং"}</span>
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
            aria-label={t("nav.theme")}
            title={t("nav.theme")}
          >
            <span aria-hidden="true">{theme === "dark" ? "◐" : theme === "light" ? "☀" : "◑"}</span>
          </button>
          <Link to="/account" className={styles.iconButton} aria-label={t("nav.account")}>
            <UserIcon />
          </Link>
          <Link to="/cart" className={styles.cartButton} aria-label={`${t("nav.cart")} · ${t("cart.items", { count })}`}>
            <CartIcon size={20} />
            <span className={styles.cartLabel}>{t("nav.cart")}</span>
            {count > 0 ? <span className={styles.cartCount}>{count}</span> : null}
          </Link>
        </div>
      </header>

      <main id="main" className="undal-main">
        <div className="undal-shell">{children}</div>
      </main>

      {count > 0 && location.pathname !== "/cart" && location.pathname !== "/checkout" ? (
        <div className={styles.cartBar}>
          <div className={styles.cartBarText}>
            <strong>
              <Money paisa={total} />
            </strong>
            <span className={styles.cartBarCount}>{t("cart.items", { count })}</span>
          </div>
          <Link to="/cart" className={styles.cartBarLink}>
            {t("nav.cart")}
          </Link>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <p className={styles.footerHeading}>{t("app.name")}</p>
            <p>{t("app.tagline")}</p>
          </div>
          <div>
            <p className={styles.footerHeading}>{t("nav.help")}</p>
            <ul className={styles.footerList}>
              <li>
                <Link className={styles.footerLink} to="/help">
                  {t("page.help.title")}
                </Link>
              </li>
              <li>
                <Link className={styles.footerLink} to="/contact">
                  {t("page.contact.title")}
                </Link>
              </li>
              <li>
                <Link className={styles.footerLink} to="/app">
                  {t("page.app.title")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className={styles.footerHeading}>{t("page.about.title")}</p>
            <ul className={styles.footerList}>
              <li>
                <Link className={styles.footerLink} to="/about">
                  {t("page.about.title")}
                </Link>
              </li>
              <li>
                <Link className={styles.footerLink} to="/join/restaurant">
                  {t("join.restaurant.title")}
                </Link>
              </li>
              <li>
                <Link className={styles.footerLink} to="/join/rider">
                  {t("join.rider.title")}
                </Link>
              </li>
            </ul>
          </div>
          <p className={styles.licence}>
            © {new Date().getFullYear()} Undal. {t("page.licence.title")}: PASVL-1.0.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Whether the browser believes it has a connection; `true` during the prerender pass. */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

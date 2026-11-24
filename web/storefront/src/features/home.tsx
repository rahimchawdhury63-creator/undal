/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The home page: the filter rail, the vendor grid, and the empty state that ships on day one.
 *
 * The page is a loader's data rendered without a client fetch: React Router hands the route its
 * vendors before the component mounts, the prerender pass has already produced the same HTML, and
 * what a crawler reads is what a customer sees. Filtering is a navigation, not local state, so
 * every filtered view is a URL that can be shared and indexed.
 */

import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import type { Area, Category, Vendor } from "../lib/api.ts";
import { pick, useLocale, useT } from "../lib/locale.tsx";
import { VendorCard } from "../components/VendorCard.tsx";
import { EmptyState, ErrorState } from "../components/states.tsx";
import { Chip, Row, SectionTitle } from "../components/ui.tsx";
import type { ApiError } from "../lib/api.ts";
import styles from "./feature.module.css";

/** What the home loader hands the page. */
export interface HomeData {
  readonly areas: readonly Area[];
  readonly categories: readonly Category[];
  readonly vendors: readonly Vendor[];
  readonly areaSlug: string | null;
  readonly sort: string;
  readonly category: string | null;
  readonly error: ApiError | null;
}

/** One of the four sorts the brief names. */
const SORTS = [
  { key: "RECOMMENDED", label: "home.sort.recommended" },
  { key: "NEAREST", label: "home.sort.nearest" },
  { key: "FASTEST", label: "home.sort.fastest" },
  { key: "TOP_RATED", label: "home.sort.topRated" },
] as const;

/** The storefront's front page. */
export function HomePage({ data }: { readonly data: HomeData }): ReactNode {
  const t = useT();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const area = data.areas.find((candidate) => candidate.slug === data.areaSlug) ?? data.areas[0] ?? null;
  const areaName = area === null ? t("home.empty.area") : pick(locale, area.name, area.nameBn);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="home-hero-title">
        <div>
          <h1 id="home-hero-title" className={styles.heroTitle}>
            {t("home.hero.title")}
          </h1>
          <p className={styles.heroBody}>{t("home.hero.subtitle")}</p>
          <form
            className={styles.heroSearch}
            role="search"
            action="/search"
            onSubmit={(event) => {
              const field = new FormData(event.currentTarget).get("q");
              if (typeof field === "string" && field.trim() === "") event.preventDefault();
            }}
          >
            <label className="undal-visually-hidden" htmlFor="home-search">
              {t("action.search")}
            </label>
            <input id="home-search" name="q" className={styles.heroInput} type="search" />
            <button type="submit" className="undal-skip-link" style={{ position: "static", transform: "none" }}>
              {t("action.search")}
            </button>
          </form>
        </div>
        <aside className={styles.heroAside} aria-label={t("home.location.label")}>
          <p className={styles.heroAsideTitle}>{t("home.location.label")}</p>
          <p className={styles.heroStat}>{areaName}</p>
          <p>
            {t("home.count", { count: area?.vendorCount ?? data.vendors.length })}
          </p>
          <Row>
            {data.areas.slice(0, 4).map((candidate) => (
              <Chip
                key={candidate.slug}
                active={candidate.slug === area?.slug}
                onClick={() => setParam("area", candidate.slug)}
              >
                {pick(locale, candidate.name, candidate.nameBn)}
              </Chip>
            ))}
          </Row>
        </aside>
      </section>

      {data.error !== null ? (
        <ErrorState error={data.error} onRetry={() => window.location.reload()} />
      ) : (
        <div className={styles.layout}>
          <aside className={styles.rail} aria-label={t("home.filters.title")}>
            <div className={styles.railGroup}>
              <p className={styles.railHeading}>{t("home.filters.sort")}</p>
              <div className={styles.chips}>
                {SORTS.map((sort) => (
                  <Chip
                    key={sort.key}
                    active={data.sort === sort.key}
                    onClick={() => setParam("sort", sort.key === "RECOMMENDED" ? null : sort.key)}
                  >
                    {t(sort.label)}
                  </Chip>
                ))}
              </div>
            </div>
            <div className={styles.railGroup}>
              <p className={styles.railHeading}>{t("home.filters.cuisine")}</p>
              <div className={styles.chips}>
                {data.categories.map((category) => (
                  <Chip
                    key={category.slug}
                    active={data.category === category.slug}
                    onClick={() => setParam("category", data.category === category.slug ? null : category.slug)}
                  >
                    {pick(locale, category.nameEn, category.nameBn)}
                  </Chip>
                ))}
              </div>
            </div>
          </aside>

          <section className={styles.section} aria-label={t("home.allRestaurants")}>
            <SectionTitle
              action={<span className={styles.muted}>{t("home.count", { count: data.vendors.length })}</span>}
            >
              {data.vendors.length === 0 && (data.category !== null || data.sort !== "RECOMMENDED")
                ? t("home.noFilters.title")
                : t("home.allRestaurants")}
            </SectionTitle>

            {data.vendors.length === 0 ? (
              data.category !== null || data.sort !== "RECOMMENDED" ? (
                <EmptyState
                  compact
                  title={t("home.noFilters.title")}
                  body={t("home.noFilters.body")}
                  actionLabel={t("home.noFilters.action")}
                  to={area === null ? "/" : `/?area=${area.slug}`}
                />
              ) : (
                <EmptyState
                  title={t("home.empty.title", { area: areaName })}
                  body={t("home.empty.body")}
                  actionLabel={t("home.empty.action")}
                  to="/join/restaurant"
                />
              )
            ) : (
              <div className={styles.grid}>
                {data.vendors.map((vendor) => (
                  <VendorCard key={vendor.id} vendor={vendor} />
                ))}
              </div>
            )}

            {data.areas.length > 0 ? (
              <nav aria-label={t("home.location.change")} className={styles.chips}>
                {data.areas.map((candidate) => (
                  <Link key={candidate.slug} className={styles.chips} to={`/a/${candidate.slug}`}>
                    {pick(locale, candidate.name, candidate.nameBn)}
                  </Link>
                ))}
              </nav>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

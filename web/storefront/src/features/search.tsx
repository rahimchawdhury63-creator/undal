/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Search results: kitchens and dishes in one list.
 *
 * A search that finds nothing says so and offers the two things a person actually wants next — the
 * restaurants near them, or the search field again with what they typed still in it.
 */

import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import type { Vendor } from "../lib/api.ts";
import { pick, useLocale, useT } from "../lib/locale.tsx";
import { VendorCard } from "../components/VendorCard.tsx";
import { EmptyState } from "../components/states.tsx";
import { Money } from "../components/Money.tsx";
import { Card, Row, SectionTitle } from "../components/ui.tsx";
import styles from "./feature.module.css";

/** What the search loader returns. */
export interface SearchData {
  readonly query: string;
  readonly vendors: readonly Vendor[];
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly nameBn: string | null;
    readonly pricePaisa: number;
    readonly vendorSlug: string;
    readonly vendorName: string;
    readonly vendorPanelName: string | null;
    readonly availability: string;
  }[];
}

/** The search page. */
export function SearchPage({ data }: { readonly data: SearchData }): ReactNode {
  const t = useT();
  const locale = useLocale();
  const [params] = useSearchParams();
  const empty = data.vendors.length === 0 && data.items.length === 0;

  return (
    <div className={styles.page}>
      <form className={styles.form} role="search" action="/search">
        <label className="undal-visually-hidden" htmlFor="search-query">
          {t("action.search")}
        </label>
        <input
          id="search-query"
          name="q"
          type="search"
          defaultValue={params.get("q") ?? ""}
          placeholder={t("home.searchPlaceholder")}
          className={styles.heroInput}
          style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border-hairline)" }}
        />
      </form>

      {empty ? (
        <EmptyState
          title={t("home.noFilters.title")}
          body={t("home.noFilters.body")}
          actionLabel={t("cart.empty.action")}
          to="/"
        />
      ) : (
        <div className={styles.section}>
          {data.vendors.length === 0 ? null : (
            <section className={styles.section}>
              <SectionTitle>{t("home.allRestaurants")}</SectionTitle>
              <div className={styles.grid}>
                {data.vendors.map((vendor) => (
                  <VendorCard key={vendor.id} vendor={vendor} />
                ))}
              </div>
            </section>
          )}
          {data.items.length === 0 ? null : (
            <section className={styles.section}>
              <SectionTitle>{t("order.items")}</SectionTitle>
              <Card>
                {data.items.map((item) => (
                  <Link
                    key={item.id}
                    to={`/r/${item.vendorSlug}`}
                    className={styles.lineRow}
                    style={{ paddingInline: "var(--space-4)" }}
                  >
                    <div>
                      <p className={styles.lineName}>{pick(locale, item.name, item.nameBn)}</p>
                      <p className={styles.lineOptions}>{pick(locale, item.vendorName, item.vendorPanelName)}</p>
                    </div>
                    <Row>
                      <Money paisa={item.pricePaisa} size="sm" />
                    </Row>
                  </Link>
                ))}
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

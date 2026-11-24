/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The vendor page: a kitchen's header, its sections and its dishes.
 *
 * Adding to the cart is the only interaction here that changes state, so it is the only one that
 * needs to be instant and honest: the stepper shows the quantity the cart already holds, a sold-out
 * dish says so instead of offering a button that will fail at checkout, and a cart from another
 * kitchen refuses to merge and explains why.
 */

import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import type { Menu, MenuItem, ModifierGroup, Vendor } from "../lib/api.ts";
import { useCart, type CartVendor } from "../lib/cart.ts";
import { pick, useLocale, useT } from "../lib/locale.tsx";
import { Money } from "../components/Money.tsx";
import { Button, Card, Panel, Row, SectionTitle } from "../components/ui.tsx";
import { ClockIcon, MinusIcon, PlusIcon, StarIcon } from "../components/icons.tsx";
import styles from "./feature.module.css";

/** A vendor page's data. */
export interface VendorPageData {
  readonly vendor: Vendor;
  readonly menu: Menu;
  readonly categories: readonly { slug: string; nameEn: string; nameBn: string }[];
}

/** The vendor's menu, with a live stepper per dish. */
export function VendorPage({ data }: { readonly data: VendorPageData }): ReactNode {
  const t = useT();
  const locale = useLocale();
  const cart = useCart();
  const [notice, setNotice] = useState<string | null>(null);
  const vendor = data.vendor;
  const cartVendor: CartVendor = {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.name,
    nameBn: vendor.nameBn,
  };
  const closed = vendor.openState !== "OPEN" && vendor.openState !== "BUSY";
  const rating = vendor.ratingBps === null ? null : (vendor.ratingBps / 100).toFixed(1);

  const add = (item: MenuItem, groups: readonly ModifierGroup[]) => {
    const chosen = groups
      .map((group) => group.modifiers.find((modifier) => modifier.available))
      .filter((modifier): modifier is NonNullable<typeof modifier> => modifier !== undefined)
      .map((modifier) => ({
        id: modifier.id,
        nameEn: modifier.nameEn,
        nameBn: modifier.nameBn,
        priceDeltaPaisa: modifier.priceDeltaPaisa,
      }));
    const result = cart.add(
      {
        itemId: item.id,
        name: item.name,
        nameBn: item.nameBn,
        unitPricePaisa: item.pricePaisa,
        modifiers: chosen,
        quantity: 1,
        note: null,
        imageUrl: item.imageUrl,
      },
      cartVendor,
    );
    setNotice(result.ok ? null : t("cart.oneVendorNote"));
  };

  return (
    <div className={styles.page}>
      <header className={styles.vendorHeader}>
        <Row>
          <h1 className={styles.vendorTitle}>{pick(locale, vendor.name, vendor.nameBn)}</h1>
          {vendor.openState === "OPEN" ? null : (
            <span className={styles.muted}>{closed ? t("vendor.closed") : t("vendor.busy")}</span>
          )}
        </Row>
        {vendor.tagline === null ? null : <p className={styles.muted}>{vendor.tagline}</p>}
        <div className={styles.vendorMeta}>
          {rating === null ? null : (
            <span className={styles.vendorMeta}>
              <StarIcon size={16} filled />
              {rating} ({t.number(vendor.ratingCount)})
            </span>
          )}
          <span className={styles.vendorMeta}>
            <ClockIcon size={16} />
            {t.minutes(Math.round(vendor.prepTimeSeconds / 60))}
          </span>
          <span>{t("vendor.minOrder", { amount: t.money(vendor.minOrderPaisa) })}</span>
          {vendor.supportsPickup ? <span>{t("vendor.supportsPickup")}</span> : null}
          {data.categories.length === 0 ? null : (
            <span>{data.categories.map((category) => pick(locale, category.nameEn, category.nameBn)).join(" · ")}</span>
          )}
        </div>
        {closed ? (
          <p className={styles.notice}>
            <span aria-hidden="true">!</span>
            <span>{t("vendor.closedNotice", { name: pick(locale, vendor.name, vendor.nameBn) })}</span>
          </p>
        ) : null}
      </header>

      {notice === null ? null : (
        <p className={styles.notice}>
          <span aria-hidden="true">!</span>
          <span>
            {notice}{" "}
            <Link to="/cart" style={{ textDecoration: "underline" }}>
              {t("nav.cart")}
            </Link>
          </span>
        </p>
      )}

      <div className={styles.twoColumn}>
        <div className={styles.menuGrid}>
          {data.menu.sections.length === 0 ? (
            <Card>
              <div style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-2)" }}>
                <h2>{t("vendor.menuEmpty.title")}</h2>
                <p className={styles.muted}>{t("vendor.menuEmpty.body")}</p>
              </div>
            </Card>
          ) : (
            data.menu.sections.map((section) => (
              <section key={section.id} className={styles.section} aria-labelledby={`section-${section.id}`}>
                <h2 id={`section-${section.id}`} className={styles.sectionHeading}>
                  {pick(locale, section.nameEn, section.nameBn)}
                </h2>
                {section.items.map((item) => {
                  const groups = data.menu.modifierGroups.filter((group) => item.modifierGroupIds.includes(group.id));
                  const quantity = cart.lines
                    .filter((line) => line.itemId === item.id)
                    .reduce((sum, line) => sum + line.quantity, 0);
                  const soldOut = item.availability !== "AVAILABLE";
                  return (
                    <article key={item.id} className={`${styles.item} ${soldOut ? styles.soldOut : ""}`}>
                      <div>
                        <h3 className={styles.itemName}>{pick(locale, item.name, item.nameBn)}</h3>
                        {item.description === null ? null : (
                          <p className={styles.itemDescription}>{pick(locale, item.description, item.descriptionBn)}</p>
                        )}
                        <p className={styles.itemPrice}>
                          <Money paisa={item.pricePaisa} size="sm" />
                        </p>
                        {soldOut ? <p className={styles.muted}>{t("item.soldOut")}</p> : null}
                      </div>
                      {soldOut ? null : quantity === 0 ? (
                        <Button size="sm" onClick={() => add(item, groups)} ariaLabel={`${t("item.add")} ${pick(locale, item.name, item.nameBn)}`}>
                          <PlusIcon size={18} />
                          {t("item.add")}
                        </Button>
                      ) : (
                        <div className={styles.stepper}>
                          <button
                            type="button"
                            className={styles.stepperButton}
                            aria-label={`${t("action.remove")} ${pick(locale, item.name, item.nameBn)}`}
                            onClick={() => {
                              const line = cart.lines.find((candidate) => candidate.itemId === item.id);
                              if (line !== undefined) cart.setQuantity(line.key, line.quantity - 1);
                            }}
                          >
                            <MinusIcon size={18} />
                          </button>
                          <span className={styles.stepperCount}>{quantity}</span>
                          <button
                            type="button"
                            className={styles.stepperButton}
                            aria-label={`${t("item.add")} ${pick(locale, item.name, item.nameBn)}`}
                            onClick={() => add(item, groups)}
                          >
                            <PlusIcon size={18} />
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <aside className={styles.sticky} aria-label={t("cart.title")}>
          <Panel>
            <SectionTitle>{t("cart.title")}</SectionTitle>
            {cart.lines.length === 0 ? (
              <p className={styles.muted}>{t("cart.empty.body")}</p>
            ) : (
              <>
                {cart.lines.map((line) => (
                  <div key={line.key} className={styles.lineRow}>
                    <div>
                      <p className={styles.lineName}>
                        {line.quantity} × {pick(locale, line.name, line.nameBn)}
                      </p>
                      {line.modifiers.length === 0 ? null : (
                        <p className={styles.lineOptions}>
                          {line.modifiers.map((modifier) => pick(locale, modifier.nameEn, modifier.nameBn)).join(", ")}
                        </p>
                      )}
                    </div>
                    <Money paisa={(line.unitPricePaisa + line.modifiers.reduce((sum, m) => sum + m.priceDeltaPaisa, 0)) * line.quantity} size="sm" />
                  </div>
                ))}
                <Link to="/cart" className={styles.center} style={{ display: "block", marginBlockStart: "var(--space-3)" }}>
                  <Button fullWidth>{t("cart.checkout")}</Button>
                </Link>
              </>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The cart page.
 *
 * Every amount here is arithmetic on integer paisa, and the delivery fee is not shown until the
 * server has priced it — a made-up fee that changes at checkout is the single most common complaint
 * about delivery apps, so this page shows the subtotal it knows and says the rest arrives with the
 * quote.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

import { lineTotalPaisa, subtotalPaisa, useCart } from "../lib/cart.ts";
import { pick, useLocale, useT } from "../lib/locale.tsx";
import { Money } from "../components/Money.tsx";
import { EmptyState } from "../components/states.tsx";
import { Button, Card, Panel, Row, SectionTitle } from "../components/ui.tsx";
import { MinusIcon, PlusIcon } from "../components/icons.tsx";
import styles from "./feature.module.css";

/** The cart, its lines and its one call to action. */
export function CartPage(): ReactNode {
  const t = useT();
  const locale = useLocale();
  const cart = useCart();
  const subtotal = subtotalPaisa(cart.lines);

  if (cart.lines.length === 0) {
    return (
      <div className={styles.page}>
        <EmptyState
          title={t("cart.empty.title")}
          body={t("cart.empty.body")}
          actionLabel={t("cart.empty.action")}
          to="/"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.twoColumn}>
        <section className={styles.section} aria-label={t("cart.title")}>
          <SectionTitle
            action={
              <Button variant="ghost" size="sm" onClick={() => cart.clear()}>
                {t("cart.clear")}
              </Button>
            }
          >
            {t("cart.title")}
          </SectionTitle>
          {cart.vendor === null ? null : (
            <p className={styles.muted}>
              {t("cart.from", { vendor: pick(locale, cart.vendor.name, cart.vendor.nameBn) })}
            </p>
          )}
          <Card>
            {cart.lines.map((line) => (
              <div key={line.key} className={styles.lineRow} style={{ paddingInline: "var(--space-4)" }}>
                <div>
                  <p className={styles.lineName}>{pick(locale, line.name, line.nameBn)}</p>
                  {line.modifiers.length === 0 ? null : (
                    <p className={styles.lineOptions}>
                      {line.modifiers.map((modifier) => pick(locale, modifier.nameEn, modifier.nameBn)).join(", ")}
                    </p>
                  )}
                  <div className={styles.stepper} style={{ marginBlockStart: "var(--space-2)" }}>
                    <button
                      type="button"
                      className={styles.stepperButton}
                      aria-label={`${t("action.remove")} ${pick(locale, line.name, line.nameBn)}`}
                      onClick={() => cart.setQuantity(line.key, line.quantity - 1)}
                    >
                      <MinusIcon size={18} />
                    </button>
                    <span className={styles.stepperCount}>{line.quantity}</span>
                    <button
                      type="button"
                      className={styles.stepperButton}
                      aria-label={`${t("item.add")} ${pick(locale, line.name, line.nameBn)}`}
                      onClick={() => cart.setQuantity(line.key, line.quantity + 1)}
                    >
                      <PlusIcon size={18} />
                    </button>
                  </div>
                </div>
                <Row>
                  <Money paisa={lineTotalPaisa(line)} size="sm" />
                  <Button variant="ghost" size="sm" onClick={() => cart.remove(line.key)}>
                    {t("action.remove")}
                  </Button>
                </Row>
              </div>
            ))}
          </Card>
          {cart.vendor === null ? null : (
            <Link to={`/r/${cart.vendor.slug}`} className={styles.muted}>
              {t("cart.addMore")}
            </Link>
          )}
        </section>

        <aside className={styles.sticky}>
          <Panel>
            <SectionTitle>{t("cart.total")}</SectionTitle>
            <div className={styles.totalRow}>
              <span>{t("cart.subtotal")}</span>
              <Money paisa={subtotal} />
            </div>
            <p className={styles.muted}>{t("checkout.payment.codNote")}</p>
            <Link to="/checkout">
              <Button fullWidth>{t("cart.checkout")}</Button>
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

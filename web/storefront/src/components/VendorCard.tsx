/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The vendor card.
 *
 * One card carries what decides a hungry person's tap: the name they recognise, a rating with a
 * count behind it, the time to their door, and whether the kitchen is actually open right now.
 * The cover image is lazy, intrinsically sized and has a blurhash placeholder colour behind it, so
 * the card never reflows and never shows an empty grey rectangle.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Vendor } from "../lib/api.ts";
import { pick, useLocale, useT } from "../lib/locale.tsx";
import { ClockIcon, StarIcon } from "./icons.tsx";
import styles from "./vendor-card.module.css";

/** A kitchen's open state, as a badge a customer can read at a glance. */
function openLabel(vendor: Vendor, t: ReturnType<typeof useT>): { readonly text: string; readonly tone: string } {
  if (vendor.openState === "OPEN") return { text: t("vendor.open"), tone: styles.open };
  if (vendor.openState === "BUSY") return { text: t("vendor.busy"), tone: styles.busy };
  if (vendor.openState === "PAUSED") return { text: t("vendor.paused"), tone: styles.closed };
  if (vendor.openState === "UNREACHABLE") return { text: t("vendor.unreachable"), tone: styles.closed };
  return { text: t("vendor.closed"), tone: styles.closed };
}

/** One vendor, as a card in a grid or a row in a list. */
export function VendorCard({ vendor }: { readonly vendor: Vendor }): ReactNode {
  const t = useT();
  const locale = useLocale();
  const name = pick(locale, vendor.name, vendor.nameBn);
  const state = openLabel(vendor, t);
  const rating = vendor.ratingBps === null ? null : (vendor.ratingBps / 100).toFixed(1);

  return (
    <article className={styles.card}>
      <Link className={styles.link} to={`/r/${vendor.slug}`}>
        <div className={styles.media} style={{ background: vendor.coverBlurhash === null ? "var(--color-bg-panel)" : undefined }}>
          {vendor.coverUrl === null ? (
            <span className={styles.mediaFallback} aria-hidden="true">
              {name.slice(0, 1)}
            </span>
          ) : (
            <img
              className={styles.cover}
              src={vendor.coverUrl}
              alt=""
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
            />
          )}
          <span className={`${styles.state} ${state.tone}`}>{state.text}</span>
        </div>
        <div className={styles.body}>
          <h3 className={styles.name}>{name}</h3>
          {vendor.tagline === null ? null : <p className={styles.tagline}>{vendor.tagline}</p>}
          <div className={styles.meta}>
            {rating === null ? (
              <span className={styles.metaItem}>{t("vendor.rating", { rating: "—", count: 0 })}</span>
            ) : (
              <span className={styles.metaItem}>
                <StarIcon size={16} filled />
                {rating} ({t.number(vendor.ratingCount)})
              </span>
            )}
            <span className={styles.metaItem}>
              <ClockIcon size={16} />
              {t.minutes(Math.round(vendor.prepTimeSeconds / 60))}
            </span>
            {vendor.distanceM === null ? null : (
              <span className={styles.metaItem}>{t.distance(vendor.distanceM)}</span>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}

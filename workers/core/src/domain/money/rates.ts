/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The rates every posting set uses, in basis points, exactly as `24 §2.1` prints them.
 *
 * The Brain computes the same numbers from the same table. They are duplicated here as
 * constants rather than fetched from `platform_config` because a ledger posting must not be
 * able to disagree with the fare that produced it: the order carries the amounts it was
 * charged, and these rates are what the posting verifies them against.
 */

/** Commission on the food subtotal: 15%. */
export const COMMISSION_BPS = 1_500;
/** Rider bonus, vendor-funded: 3%. */
export const RIDER_BONUS_BPS = 300;
/** Platform margin inside the delivery fee: 8% of the ride core. */
export const DELIVERY_MARGIN_BPS = 800;
/** Tax on the platform's own fee revenue: 5%. */
export const TAX_BPS = 500;

/**
 * @file packages/shared_ts/src/i18n.ts
 * @description Canonical UNDAL Bilingual Localisation Framework (`English` + `বাংলা`, `D-20`, `Appendix H`).
 *
 * Enforces 100% key and `{placeholder}` parity across `en`, `bn`, and Flutter's `app_en.arb`/`app_bn.arb`
 * at test time so no untranslated string or broken interpolation placeholder ever reaches a user.
 */

import type { UndalLocale } from './money.ts';
import { toBengaliDigits } from './money.ts';

/** Canonical English catalogue containing all 48 `Appendix H` seeds + shared shell chrome keys (`60` keys). */
export const UNDAL_MESSAGES_EN = {
  'app.name': 'Undal',
  'app.tagline': 'Real food. Real-time. No games.',
  'app.subtitle_food_only': 'Food delivery & counter pickup across Bangladesh — Cash on Delivery',
  'app.admin_title': 'Undal Super Admin',
  'app.theme_light': 'Light cream',
  'app.theme_dark': 'Dark night',
  'app.switch_language': 'বাংলা',
  'app.zone_active': 'Active zone: {zone}',
  'app.cod_badge': '100% Cash on Delivery · Zero hidden VAT markup',
  'app.status_ready': 'Workspace shell verified and connected to shared tokens',
  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.retry': 'Retry',
  'common.search': 'Search',
  'common.save': 'Save',
  'common.delivery': 'Delivery',
  'common.pickup': 'Pick-up',
  'nav.home': 'Home',
  'nav.search': 'Search',
  'nav.orders': 'Orders',
  'nav.cart': 'Cart',
  'nav.account': 'Account',
  'home.explore_nearby': 'Explore kitchens near you',
  'home.flash_box': 'Flash Box',
  'home.order_again': 'Order again',
  'home.home_kitchens': 'Home Kitchens',
  'cart.title': 'Your cart',
  'cart.add_more': 'Add more items',
  'cart.cutlery_off': 'No cutlery. Thanks for reducing waste!',
  'checkout.cod': 'Cash on Delivery',
  'checkout.pay_counter': 'Pay at counter (cash)',
  'checkout.place_order': 'Place order',
  'checkout.tip_rider': 'Tip your rider (in cash)',
  'order.placed': 'Order placed',
  'order.accepted': 'Kitchen accepted your order',
  'order.preparing': 'Preparing your food',
  'order.rider_assigned': 'Rider assigned',
  'order.picked': 'Picked up — on the way',
  'order.delivered': 'Delivered. Enjoy!',
  'order.cancelled_unreachable': 'Cancelled — kitchen unreachable',
  'vendor.new_order': 'NEW ORDER',
  'vendor.accept': 'Accept',
  'vendor.reject': 'Reject',
  'vendor.prep_time': 'Preparation time',
  'vendor.mark_ready': 'Mark ready',
  'rider.new_offer': 'New delivery offer',
  'rider.accept': 'Accept order',
  'rider.arrived_vendor': 'Arrived at kitchen',
  'rider.scan_qr': 'Scan pickup QR',
  'rider.delivered_btn': 'Delivered — cash collected',
  'rider.cash_gate_title': 'Cash submission due',
  'rider.cash_gate_body': 'Send the collected cash to the Undal bKash number, then submit the TrxID.',
  'rider.why_this_fare': 'Why this fare?',
  'alarm.test': 'Send test alarm',
  'alarm.armed': 'Alerts ARMED',
  'alarm.at_risk': 'Alerts AT RISK — tap to fix',
  'auth.login': 'Log in',
  'auth.signup': 'Sign up',
  'auth.google': 'Continue with Google',
} as const;

export type UndalMessageKey = keyof typeof UNDAL_MESSAGES_EN;

/** Canonical Bengali (`বাংলা`) catalogue typed strictly to match `UNDAL_MESSAGES_EN` key-for-key. */
export const UNDAL_MESSAGES_BN: Readonly<Record<UndalMessageKey, string>> = {
  'app.name': 'উন্দাল',
  'app.tagline': 'আসল খাবার। সত্যিকারের দ্রুত।',
  'app.subtitle_food_only': 'সারা বাংলাদেশে ফুড ডেলিভারি ও কাউন্টার পিকআপ — ক্যাশ অন ডেলিভারি',
  'app.admin_title': 'উন্দাল সুপার অ্যাডমিন',
  'app.theme_light': 'লাইট ক্রিম',
  'app.theme_dark': 'ডার্ক নাইট',
  'app.switch_language': 'English',
  'app.zone_active': 'সক্রিয় জোন: {zone}',
  'app.cod_badge': '১০০% ক্যাশ অন ডেলিভারি · অতিরিক্ত গোপন ভ্যাট নেই',
  'app.status_ready': 'শেয়ার্ড টোকেন ও লোকালিলাইজেশন সক্রিয় আছে',
  'common.continue': 'চালিয়ে যান',
  'common.cancel': 'বাতিল',
  'common.confirm': 'নিশ্চিত করুন',
  'common.retry': 'আবার চেষ্টা',
  'common.search': 'খুঁজুন',
  'common.save': 'সংরক্ষণ',
  'common.delivery': 'ডেলিভারি',
  'common.pickup': 'পিকআপ',
  'nav.home': 'হোম',
  'nav.search': 'খুঁজুন',
  'nav.orders': 'অর্ডার',
  'nav.cart': 'কার্ট',
  'nav.account': 'অ্যাকাউন্ট',
  'home.explore_nearby': 'কাছের রান্নাঘর দেখুন',
  'home.flash_box': 'ফ্ল্যাশ বক্স',
  'home.order_again': 'আবার অর্ডার করুন',
  'home.home_kitchens': 'হোম কিচেন',
  'cart.title': 'আপনার কার্ট',
  'cart.add_more': 'আরও যোগ করুন',
  'cart.cutlery_off': 'চামচ দেবেন না। বর্জ্য কমানোর জন্য ধন্যবাদ!',
  'checkout.cod': 'ক্যাশ অন ডেলিভারি',
  'checkout.pay_counter': 'কাউন্টারে নগদ দিন',
  'checkout.place_order': 'অর্ডার করুন',
  'checkout.tip_rider': 'রাইডারকে টিপ দিন (নগদে)',
  'order.placed': 'অর্ডার হয়েছে',
  'order.accepted': 'রেস্টুরেন্ট অর্ডার নিয়েছে',
  'order.preparing': 'আপনার খাবার তৈরি হচ্ছে',
  'order.rider_assigned': 'রাইডার নিয়োগ হয়েছে',
  'order.picked': 'রওনা হয়েছে',
  'order.delivered': 'ডেলিভারি হয়েছে। উপভোগ করুন!',
  'order.cancelled_unreachable': 'বাতিল — রেস্টুরেন্টকে পাওয়া যায়নি',
  'vendor.new_order': 'নতুন অর্ডার',
  'vendor.accept': 'গ্রহণ করুন',
  'vendor.reject': 'বাতিল করুন',
  'vendor.prep_time': 'প্রস্তুতির সময়',
  'vendor.mark_ready': 'তৈরি হয়ে গেছে',
  'rider.new_offer': 'নতুন ডেলিভারি অফার',
  'rider.accept': 'অর্ডার নিন',
  'rider.arrived_vendor': 'রেস্টুরেন্টে পৌঁছেছি',
  'rider.scan_qr': 'পিকআপ QR স্ক্যান',
  'rider.delivered_btn': 'ডেলিভারি সম্পন্ন — টাকা নেওয়া হয়েছে',
  'rider.cash_gate_title': 'নগদ টাকা জমা বাকি',
  'rider.cash_gate_body': 'সংগৃহীত টাকা Undal বিকাশ নম্বরে পাঠিয়ে TrxID জমা দিন।',
  'rider.why_this_fare': 'এই ভাড়া কীভাবে নির্ধারিত হলো?',
  'alarm.test': 'টেস্ট অ্যালার্ম পাঠান',
  'alarm.armed': 'অ্যালার্ট চালু আছে',
  'alarm.at_risk': 'অ্যালার্ট ঝুঁকিতে — ঠিক করতে ট্যাপ করুন',
  'auth.login': 'লগইন',
  'auth.signup': 'সাইন আপ',
  'auth.google': 'Google দিয়ে চালিয়ে যান',
} as const;

/**
 * Formats a localised message by key with optional `{name}` interpolation (`bn` automatically formats numbers in Bengali digits).
 */
export function t(
  locale: UndalLocale,
  key: UndalMessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const dict = locale === 'bn' ? UNDAL_MESSAGES_BN : UNDAL_MESSAGES_EN;
  const template = dict[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const rawVal = params[token];
    if (rawVal === undefined) return `{${token}}`;
    const str = String(rawVal);
    return locale === 'bn' && typeof rawVal === 'number' ? toBengaliDigits(str) : str;
  });
}

/**
 * Verifies exact EN <=> BN key set equality, non-empty translations, and `{placeholder}` parity (`File 26 §26.4`).
 */
export function verifyLocaleParity(
  enDict: Readonly<Record<string, string>> = UNDAL_MESSAGES_EN,
  bnDict: Readonly<Record<string, string>> = UNDAL_MESSAGES_BN,
): string[] {
  const issues: string[] = [];
  const enKeys = new Set(Object.keys(enDict));
  const bnKeys = new Set(Object.keys(bnDict));

  for (const key of enKeys) {
    if (!bnKeys.has(key)) issues.push(`Missing BN translation key: ${key}`);
    if (!enDict[key]?.trim()) issues.push(`Empty EN string for key: ${key}`);
  }
  for (const key of bnKeys) {
    if (!enKeys.has(key)) issues.push(`Orphan BN key missing from EN: ${key}`);
    if (!bnDict[key]?.trim()) issues.push(`Empty BN string for key: ${key}`);
  }

  for (const key of enKeys) {
    if (!bnKeys.has(key)) continue;
    const enPlaceholders = [...(enDict[key]?.matchAll(/\{(\w+)\}/g) ?? [])].map((m) => m[1]).sort();
    const bnPlaceholders = [...(bnDict[key]?.matchAll(/\{(\w+)\}/g) ?? [])].map((m) => m[1]).sort();
    if (enPlaceholders.join(',') !== bnPlaceholders.join(',')) {
      issues.push(
        `Placeholder mismatch for "${key}": EN=[${enPlaceholders.join(',')}] vs BN=[${bnPlaceholders.join(',')}]`,
      );
    }
  }
  return issues;
}

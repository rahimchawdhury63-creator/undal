/**
 * @file workers/api/src/routes/partner-onboarding-helpers.ts
 * @description Shared validation, formatting, policy constants, and privacy-safe response helpers for Partner W1 onboarding.
 */

import { jsonOk } from '../http.ts';
import type { ApiDbAdapter } from '../types.ts';

export const VENDOR_TYPES = new Set<string>(['RESTAURANT', 'HOME_KITCHEN', 'CLOUD_KITCHEN']);
export const MFS_PHONE_RE = /^01[3-9][0-9]{8}$/;
export const BANK_ACCOUNT_RE = /^[0-9]{8,34}$/;
export const TIME_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const TERMS_VERSION = 'partner-commission-v1';
/** SHA-256 of UTF-8 `${TERMS_VERSION}\n${TERMS_EN}\n${TERMS_BN}`. */
export const TERMS_HASH = 'c4fd6022b88d7f8e37250f9f5b9dc87f53586e795b54c1c8291b3ec2100f4751';
export const TERMS_EN = '15% platform commission. Menu prices are VAT-inclusive and VAT is extracted as 5/105 of food payable under the published settlement schedule. No monthly listing fee and no advertising fee.';
export const TERMS_BN = 'প্ল্যাটফর্ম কমিশন ১৫%। মেনুর মূল্য VAT-সহ; প্রকাশিত সেটেলমেন্ট নীতি অনুযায়ী খাবারের পরিশোধযোগ্য মূল্যের ৫/১০৫ VAT হিসেবে হিসাব করা হয়। মাসিক তালিকাভুক্তি ফি ও বিজ্ঞাপন ফি নেই।';
const HYGIENE_KEYS = ['clean_water', 'safe_storage', 'clean_surfaces', 'food_grade_packaging'] as const;
const RESTAURANT_DOCS = new Set(['trade_license', 'nid_front', 'nid_back', 'passport_front', 'passport_back', 'tin', 'bin', 'bank_proof', 'bkash_proof', 'nagad_proof', 'menu_doc']);
const KITCHEN_DOCS = new Set(['trade_license', 'nid_front', 'nid_back', 'passport_front', 'passport_back', 'tin', 'bin', 'bank_proof', 'bkash_proof', 'nagad_proof', 'utility_bill', 'kitchen_hygiene_photo', 'menu_doc']);

/** Normalizes ASCII and Bengali digits and strips safe Bangladesh phone formatting characters. */
export function normalizePhone(value: string): string {
  return Array.from(value.trim(), (char) => {
    const cp = char.codePointAt(0) ?? 0;
    return cp >= 0x09e6 && cp <= 0x09ef ? String(cp - 0x09e6) : char;
  }).join('').replace(/[\s()+-]/g, '');
}

/** Validates canonical Bangladesh local mobile format. */
export function validBdPhone(value: unknown): value is string {
  return typeof value === 'string' && MFS_PHONE_RE.test(normalizePhone(value));
}

/** Parses `HH:mm` into local minutes after midnight. */
function minuteOfDay(value: string): number {
  const [hourPart = '0', minutePart = '0'] = value.split(':');
  return Number(hourPart) * 60 + Number(minutePart);
}

/** Computes a non-zero shift duration, including shifts that cross midnight. */
export function shiftDuration(open: string, close: string): number {
  return (minuteOfDay(close) - minuteOfDay(open) + 1440) % 1440;
}

/** Creates a collision-resistant private vendor slug from the chosen brand. */
export function draftSlug(brandName: string): string {
  const stem = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'kitchen';
  return `${stem}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Reads the authenticated profile's one current application or returns null for first-time applicants. */
export async function ownApplication(db: ApiDbAdapter, profileId: string): Promise<Record<string, unknown> | null> {
  return await db.getVendorApplication(profileId);
}

/** Returns owner-private application payloads with browser/proxy caching disabled. */
export function applicationResponse(application: Record<string, unknown> | null, requestId: string, status = 200): Response {
  return jsonOk({ application }, requestId, status, { 'Cache-Control': 'private, no-store' });
}

/** Decodes a configured base64 SPKI key without retaining or leaking its value. */
function decodeBase64Key(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.trim());
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Encrypts a payout beneficiary with W1's RSA-OAEP public key and returns only hex ciphertext. */
export async function encryptPayoutAccount(account: string, publicKeyB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('spki', decodeBase64Key(publicKeyB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(account));
  return Array.from(new Uint8Array(encrypted), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Validates a bounded structured onboarding menu using integer poisha prices only. */
export function parseOnboardingMenu(value: unknown): readonly Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const rows: Record<string, unknown>[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const price = row.price_poisha;
    if (name.length < 2 || name.length > 100 || typeof price !== 'number' || !Number.isSafeInteger(price) || price < 1) return null;
    rows.push({ name, price_poisha: price });
  }
  return rows;
}

/** Validates all four required home/cloud-kitchen hygiene attestations as explicit booleans. */
export function validHygieneChecklist(value: unknown): value is Record<(typeof HYGIENE_KEYS)[number], boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checklist = value as Record<string, unknown>;
  return HYGIENE_KEYS.every((key) => checklist[key] === true);
}

/** Validates date-only fields and rejects calendar rollover values. */
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Normalizes SQL date-only strings and PGlite `Date` values to a calendar-day string. */
export function dateOnlyString(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return value.slice(0, 10);
  return null;
}

/** Accepts valid PostgREST ISO timestamps and PostgreSQL driver `Date` values. */
export function isTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Chooses the exact document allow-list for the current restaurant or kitchen track. */
export function allowedDocumentTypes(vendorType: unknown): ReadonlySet<string> {
  return vendorType === 'RESTAURANT' ? RESTAURANT_DOCS : KITCHEN_DOCS;
}

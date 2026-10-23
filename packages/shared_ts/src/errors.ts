/**
 * @file packages/shared_ts/src/errors.ts
 * @description Canonical UNDAL Bilingual Error Code Catalogue (`Appendix G` — all 35 seed entries
 * plus 4 security/idempotency admin codes) and standard Worker JSON response envelope builders (`Appendix E`).
 *
 * Clients map `error.code` -> localised EN/বাংলা copy and never display raw stack traces.
 */

export interface ErrorCatalogEntry {
  readonly httpStatus: number;
  readonly en: string;
  readonly bn: string;
}

/** Complete immutable error registry (`Appendix G` + admin TOTP/idempotency codes). */
export const UNDAL_ERROR_CATALOG = {
  AUTH_INVALID_CREDENTIALS: { httpStatus: 401, en: 'Email/phone or password is incorrect.', bn: 'ইমেইল/ফোন বা পাসওয়ার্ড সঠিক নয়।' },
  AUTH_ACCOUNT_SUSPENDED: { httpStatus: 403, en: 'Your account is suspended. Contact support.', bn: 'আপনার অ্যাকাউন্ট সাময়িকভাবে বন্ধ আছে। সাপোর্টে যোগাযোগ করুন।' },
  AUTH_ROLE_MISMATCH: { httpStatus: 403, en: 'This account cannot use this app.', bn: 'এই অ্যাকাউন্ট দিয়ে এই অ্যাপ ব্যবহার করা যাবে না।' },
  AUTH_TOTP_REQUIRED: { httpStatus: 403, en: 'Two-factor authentication (TOTP) setup is required.', bn: 'টু-ফ্যাক্টর যাচাইকরণ (TOTP) চালু করা আবশ্যক।' },
  AUTH_STEP_UP_REQUIRED: { httpStatus: 403, en: 'Confirm your 6-digit authenticator code to continue.', bn: 'চালিয়ে যেতে আপনার ৬-সংখ্যার যাচাইকরণ কোড দিন।' },
  AUTH_FORBIDDEN_PERMISSION: { httpStatus: 403, en: 'You do not have permission for this action.', bn: 'এই কাজের অনুমতি আপনার নেই।' },
  IDEMPOTENCY_KEY_REQUIRED: { httpStatus: 400, en: 'Missing Idempotency-Key request header.', bn: 'অনুরোধে Idempotency-Key অনুপস্থিত।' },
  VALIDATION_FAILED: { httpStatus: 422, en: 'Some information needs fixing.', bn: 'কিছু তথ্য ঠিক করতে হবে।' },
  PHONE_INVALID_BD: { httpStatus: 422, en: 'Enter a valid Bangladeshi mobile number.', bn: 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন।' },
  CART_STALE: { httpStatus: 409, en: 'Prices changed. Please review your cart.', bn: 'দাম বদলে গেছে। কার্ট আবার দেখুন।' },
  CART_VENDOR_CONFLICT: { httpStatus: 409, en: 'Your cart has items from another kitchen.', bn: 'আপনার কার্টে অন্য রেস্টুরেন্টের আইটেম আছে।' },
  ITEM_UNAVAILABLE: { httpStatus: 409, en: 'An item just went unavailable.', bn: 'একটি আইটেম এখন পাওয়া যাচ্ছে না।' },
  VENDOR_CLOSED: { httpStatus: 409, en: 'This kitchen is closed right now.', bn: 'এই রেস্টুরেন্ট এখন বন্ধ আছে।' },
  OUTSIDE_ZONE: { httpStatus: 422, en: 'Delivery is not available at this pin yet.', bn: 'এই লোকেশনে এখন ডেলিভারি হয় না।' },
  VOUCHER_INVALID: { httpStatus: 422, en: 'This voucher cannot be used here.', bn: 'এই ভাউচার এখানে চলবে না।' },
  VOUCHER_MIN_ORDER: { httpStatus: 422, en: 'Add a little more to use this voucher.', bn: 'ভাউচার ব্যবহার করতে আরেকটু যোগ করুন।' },
  MIN_ORDER_NOT_MET: { httpStatus: 422, en: 'Minimum order is not met.', bn: 'সর্বনিম্ন অর্ডারের শর্ত পূরণ হয়নি।' },
  ORDER_STATE_ILLEGAL: { httpStatus: 409, en: 'That action is not possible for this order now.', bn: 'এই অর্ডারে এখন এই কাজ করা যাবে না।' },
  VENDOR_UNREACHABLE: { httpStatus: 410, en: 'The kitchen could not be reached, so the order was cancelled.', bn: 'রেস্টুরেন্টকে পাওয়া যায়নি, তাই অর্ডার বাতিল হয়েছে।' },
  NO_RIDER_AVAILABLE: { httpStatus: 503, en: 'No rider is available nearby right now.', bn: 'কাছে এখন কোনো রাইডার নেই।' },
  OFFER_EXPIRED: { httpStatus: 410, en: 'This offer has expired.', bn: 'এই অফারের সময় শেষ।' },
  OFFER_NOT_REJECTABLE: { httpStatus: 409, en: 'No backup rider nearby — request reassign instead.', bn: 'কাছে বিকল্প রাইডার নেই — রিঅ্যাসাইন অনুরোধ করুন।' },
  QR_INVALID: { httpStatus: 422, en: 'QR code is invalid or expired.', bn: 'QR কোড সঠিক নয় বা মেয়াদ শেষ।' },
  QR_ALREADY_USED: { httpStatus: 409, en: 'This pickup code was already used.', bn: 'এই পিকআপ কোড ব্যবহার হয়ে গেছে।' },
  CASH_CEILING_REACHED: { httpStatus: 403, en: 'Cash-in-hand limit reached. Remit to continue.', bn: 'হাতের নগদ সীমা শেষ। চালিয়ে যেতে জমা দিন।' },
  CASH_GATE_ACTIVE: { httpStatus: 403, en: 'Complete your cash remittance to start a new session.', bn: 'নতুন সেশন শুরু করতে নগদ জমা সম্পন্ন করুন।' },
  TRXID_DUPLICATE: { httpStatus: 409, en: 'This transaction ID was already submitted.', bn: 'এই ট্রান্সাকশন আইডি আগে জমা হয়েছে।' },
  KYC_INCOMPLETE: { httpStatus: 403, en: 'Complete verification to continue.', bn: 'চালিয়ে যেতে যাচাই সম্পন্ন করুন।' },
  DOC_TOO_LARGE: { httpStatus: 413, en: 'File is too large (max 5 MB).', bn: 'ফাইল খুব বড় (সর্বোচ্চ ৫ MB)।' },
  IMAGE_UPLOAD_FAILED: { httpStatus: 502, en: 'Image upload failed. We will retry automatically.', bn: 'ছবি আপলোড হয়নি। অটো আবার চেষ্টা হবে।' },
  RATE_LIMITED: { httpStatus: 429, en: 'Too many attempts. Wait a moment.', bn: 'অনেকবার চেষ্টা হয়েছে। একটু অপেক্ষা করুন।' },
  LOCATION_REQUIRED: { httpStatus: 422, en: 'Turn on location to continue.', bn: 'চালিয়ে যেতে লোকেশন চালু করুন।' },
  GPS_INACCURATE: { httpStatus: 422, en: 'GPS signal is weak. Move to an open area.', bn: 'GPS সিগন্যাল দুর্বল। খোলা জায়গায় যান।' },
  NETWORK_OFFLINE: { httpStatus: 0, en: 'You are offline. Actions will sync when back.', bn: 'আপনি অফলাইনে আছেন। ফিরলে সিঙ্ক হবে।' },
  SERVER_BUSY: { httpStatus: 503, en: 'We are busy for a moment. Try again.', bn: 'আমরা এখন একটু ব্যস্ত। আবার চেষ্টা করুন।' },
  SESSION_EXPIRED: { httpStatus: 401, en: 'Please log in again.', bn: 'আবার লগইন করুন।' },
  APP_UPDATE_REQUIRED: { httpStatus: 426, en: 'Please update Undal to continue.', bn: 'চালিয়ে যেতে Undal আপডেট করুন।' },
  PAYOUT_ACCOUNT_REQUIRED: { httpStatus: 422, en: 'Add a payout account (bKash recommended).', bn: 'পেআউট অ্যাকাউন্ট যোগ করুন (বিকাশ প্রস্তাবিত)।' },
  INVOICE_NOT_PAYABLE: { httpStatus: 409, en: 'This invoice is not ready to pay.', bn: 'এই ইনভয়েস এখন পরিশোধযোগ্য নয়।' },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type UndalErrorCode = keyof typeof UNDAL_ERROR_CATALOG;

/** Standard success wire envelope (`Appendix E`). */
export function okEnvelope<T>(data: T, requestId: string): { readonly data: T; readonly request_id: string } {
  return { data, request_id: requestId };
}

/** Standard bilingual error wire envelope (`Appendix E` & `Appendix G`). */
export function errEnvelope(
  code: UndalErrorCode,
  requestId: string,
  details?: Record<string, unknown>,
) {
  const entry = UNDAL_ERROR_CATALOG[code];
  return {
    status: entry.httpStatus,
    body: {
      error: {
        code,
        message_en: entry.en,
        message_bn: entry.bn,
        ...(details !== undefined ? { details } : {}),
      },
      request_id: requestId,
    },
  };
}

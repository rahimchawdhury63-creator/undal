/**
 * @fileoverview Zero-Supabase-Storage Dual-Provider Media Law — **Cloudinary Sensitive-Only Vault** (`ADR-0006` v2).
 *
 * Architectural Law (Founder Mandate):
 *   1. **Zero Supabase Storage (`0` bytes forever).**
 *   2. **ALL public & platform images (`menu_item`, `vendor_logo`, `vendor_cover`, `profile_avatar`,
 *      `banner`, `review_photo`) MUST go to `ImgBB` (`packages/shared_ts/src/imgbb.ts`) for unlimited free storage!**
 *      Attempting to pass a public category into ANY Cloudinary function throws immediately so **zero Cloudinary
 *      quota is ever wasted on public catalog/banner/avatar traffic**!
 *   3. **Cloudinary (`UNDAL_CLOUDINARY_CLOUD_NAME`) is 100% dedicated to sensitive compliance media ONLY:**
 *      `vendor_kyc`, `rider_kyc`, `rider_shift_selfie`, `cash_remittance_proof`,
 *      `dispute_evidence`, `chat_attachment`, `invoice_pdf`
 *      using `undal/private/<category>/<ownerId>`, `fl_strip_profile`, scoped Unsigned Preset
 *      (`UNDAL_CLOUDINARY_UNSIGNED_PRESET_SECURE`) OR Worker-signed `authenticated` tickets + short-lived
 *      (`<= 600s`) SHA-256 `s--XXXXXXXX--` signed viewing URLs logged to `audit_logs`!
 */

import { PUBLIC_IMGBB_CATEGORIES, type PublicImgbbCategory } from './imgbb.ts';

export const SENSITIVE_CLOUDINARY_CATEGORIES = [
  'vendor_kyc',
  'rider_kyc',
  'rider_shift_selfie',
  'cash_remittance_proof',
  'dispute_evidence',
  'chat_attachment',
  'invoice_pdf',
] as const;

export type SensitiveCloudinaryCategory = (typeof SENSITIVE_CLOUDINARY_CATEGORIES)[number];
export type CloudinaryAssetCategory = PublicImgbbCategory | SensitiveCloudinaryCategory;
export type CloudinaryResourceType = 'image' | 'raw' | 'video';

export interface CloudinaryUnsignedUploadDescriptor {
  readonly provider: 'cloudinary';
  readonly mode: 'unsigned_preset';
  readonly uploadUrl: string;
  readonly cloudName: string;
  readonly uploadPreset: string;
  readonly folder: string;
  readonly category: SensitiveCloudinaryCategory;
  readonly resourceType: CloudinaryResourceType;
  readonly maxBytes: number;
}

export interface CloudinarySignedUploadTicket {
  readonly provider: 'cloudinary';
  readonly mode: 'signed_authenticated';
  readonly uploadUrl: string;
  readonly cloudName: string;
  readonly apiKey: string;
  readonly timestamp: number;
  readonly signature: string;
  readonly signatureAlgorithm: 'sha256';
  readonly folder: string;
  readonly publicId: string;
  readonly deliveryType: 'authenticated';
  readonly resourceType: CloudinaryResourceType;
  readonly incomingTransformation: string;
  readonly expiresInSeconds: number;
}

const SENSITIVE_SET: ReadonlySet<string> = new Set<string>(SENSITIVE_CLOUDINARY_CATEGORIES);

/** Returns `true` iff `category` is sensitive compliance media belonging in private Cloudinary storage. */
export function isPrivateCloudinaryCategory(category: string): category is SensitiveCloudinaryCategory {
  return SENSITIVE_SET.has(category);
}

/** Hard guard preventing ANY public catalog/banner/avatar image from touching Cloudinary credits. */
export function assertSensitiveCloudinaryCategory(
  category: string,
): asserts category is SensitiveCloudinaryCategory {
  if (!isPrivateCloudinaryCategory(category)) {
    throw new RangeError(
      `Category "${category}" is public platform media and MUST use Unlimited ImgBB (${PUBLIC_IMGBB_CATEGORIES.join(', ')}); Cloudinary is strictly reserved for sensitive private compliance files only.`,
    );
  }
}

function normalizeCloudName(cloudName: string): string {
  const trimmed = cloudName.trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(trimmed)) {
    throw new Error(`Invalid Cloudinary cloud name: "${cloudName}"`);
  }
  return trimmed;
}

function normalizeOwnerSegment(ownerId: string): string {
  const clean = ownerId.trim();
  if (!/^[a-z0-9-]{6,64}$/i.test(clean)) {
    throw new Error(`Invalid asset owner identifier: "${ownerId}"`);
  }
  return clean;
}

/** Converts SHA-256 bytes into lowercase hex (`64` chars) via WebCrypto. */
async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Converts SHA-256 bytes into Cloudinary's URL-safe base64 `s--XXXXXXXX--` signature (`8` chars). */
async function cloudinaryUrlToken8(payload: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  const urlSafeB64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
  return `s--${urlSafeB64.slice(0, 8)}--`;
}

/** Canonical folder path strictly inside `undal/private/<category>/<ownerId>` for sensitive files. */
export function buildCloudinaryFolder(category: SensitiveCloudinaryCategory, ownerId: string): string {
  assertSensitiveCloudinaryCategory(category);
  return `undal/private/${category}/${normalizeOwnerSegment(ownerId)}`;
}

/**
 * Builds a restricted **Cloudinary Unsigned Upload Preset** descriptor strictly for sensitive staging
 * (`UNDAL_CLOUDINARY_UNSIGNED_PRESET_SECURE`). Rejects any public category immediately.
 */
export function buildCloudinaryUnsignedUploadDescriptor(params: {
  readonly cloudName: string;
  readonly category: SensitiveCloudinaryCategory;
  readonly ownerId: string;
  readonly secureUnsignedPreset: string;
}): CloudinaryUnsignedUploadDescriptor {
  assertSensitiveCloudinaryCategory(params.category);
  const cloud = normalizeCloudName(params.cloudName);
  const uploadPreset = params.secureUnsignedPreset.trim();
  if (!uploadPreset) {
    throw new Error('Missing secure Cloudinary Unsigned Upload Preset name.');
  }
  const resourceType: CloudinaryResourceType = 'image';
  return {
    provider: 'cloudinary',
    mode: 'unsigned_preset',
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`,
    cloudName: cloud,
    uploadPreset,
    folder: buildCloudinaryFolder(params.category, params.ownerId),
    category: params.category,
    resourceType,
    maxBytes: params.category === 'invoice_pdf' ? 10 * 1024 * 1024 : 5 * 1024 * 1024,
  };
}

/**
 * Mints a server-signed **Cloudinary Authenticated (`type=authenticated`)** upload ticket (`W1`/`W3` only).
 * Automatically enforces `fl_strip_profile` EXIF stripping and `undal/private/...` isolation.
 */
export async function signCloudinaryUploadTicket(params: {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly category: SensitiveCloudinaryCategory;
  readonly ownerId: string;
  readonly assetUuid: string;
  readonly nowEpochSeconds?: number;
}): Promise<CloudinarySignedUploadTicket> {
  assertSensitiveCloudinaryCategory(params.category);
  const cloud = normalizeCloudName(params.cloudName);
  if (!params.apiKey.trim() || !params.apiSecret.trim()) {
    throw new Error('Cloudinary API key and API secret are required to sign private upload tickets.');
  }
  const folder = buildCloudinaryFolder(params.category, params.ownerId);
  const publicId = `${folder}/${normalizeOwnerSegment(params.assetUuid)}`;
  const timestamp = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const incomingTransformation = 'fl_strip_profile';
  const resourceType: CloudinaryResourceType = 'image';

  // Cloudinary alphabetical parameter canonicalization (`public_id`, `timestamp`, `transformation`, `type`)
  const toSign = `public_id=${publicId}&timestamp=${timestamp}&transformation=${incomingTransformation}&type=authenticated${params.apiSecret}`;
  const signature = await sha256Hex(toSign);

  return {
    provider: 'cloudinary',
    mode: 'signed_authenticated',
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`,
    cloudName: cloud,
    apiKey: params.apiKey.trim(),
    timestamp,
    signature,
    signatureAlgorithm: 'sha256',
    folder,
    publicId,
    deliveryType: 'authenticated',
    resourceType,
    incomingTransformation,
    expiresInSeconds: 300,
  };
}

/**
 * Mints a short-lived (`<= 600s`) SHA-256 `s--XXXXXXXX--` signed Cloudinary URL for authorized KYC,
 * cash-remittance screenshot, dispute evidence, or invoice PDF review (`pg_1,f_webp` thumbnail optional).
 */
export async function signCloudinaryAuthenticatedUrl(params: {
  readonly cloudName: string;
  readonly apiSecret: string;
  readonly publicId: string;
  readonly ttlSeconds?: number;
  readonly nowEpochSeconds?: number;
  readonly pdfPageThumbnail?: boolean;
  readonly maxWidth?: number;
}): Promise<{ readonly signedUrl: string; readonly expiresAtEpochSeconds: number }> {
  const cloud = normalizeCloudName(params.cloudName);
  if (!params.apiSecret.trim()) {
    throw new Error('CLOUDINARY_API_SECRET is required to mint signed private URLs.');
  }
  const cleanPublicId = params.publicId.replace(/^\/+/, '');
  if (!cleanPublicId.startsWith('undal/private/')) {
    throw new RangeError(`Refusing to sign non-private Cloudinary path: "${cleanPublicId}"`);
  }
  const ttl = Math.min(Math.max(params.ttlSeconds ?? 120, 30), 600);
  const nowSec = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const expiresAtEpochSeconds = nowSec + ttl;

  const transforms: string[] = [
    `e_expires_${expiresAtEpochSeconds}`,
    'fl_strip_profile',
  ];
  if (params.pdfPageThumbnail) {
    transforms.push('pg_1', `c_limit,w_${params.maxWidth ?? 900}`, 'f_webp', 'q_auto');
  } else if (params.maxWidth) {
    transforms.push(`c_limit,w_${params.maxWidth}`, 'q_auto', 'f_auto');
  }
  const transformPart = transforms.join('/');
  const toSign = `${transformPart}/${cleanPublicId}${params.apiSecret}`;
  const sigToken = await cloudinaryUrlToken8(toSign);

  return {
    signedUrl: `https://res.cloudinary.com/${cloud}/image/authenticated/${sigToken}/${transformPart}/${cleanPublicId}`,
    expiresAtEpochSeconds,
  };
}

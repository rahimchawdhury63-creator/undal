/**
 * @file packages/shared_ts/src/cloudinary.ts
 * @description Canonical UNDAL Zero-Supabase-Storage Media Engine powered 100% by Free Cloudinary
 * Services (`ADR-0006`, superseding Supabase Storage buckets across all 5 surfaces & 3 Workers).
 *
 * Capabilities (100% Cloudinary Free Plan — 25 monthly credits, 0 paid add-ons required):
 * 1. **Zero Supabase Storage (`0 bytes`)**: All KYC docs, shift selfies, cash-remittance screenshots,
 *    dispute evidence, voice/chat media, and weekly invoice PDFs live on Cloudinary private/authenticated storage.
 * 2. **Unsigned Upload Presets (`CLOUDINARY_UNSIGNED_PRESET_PUBLIC` & `CLOUDINARY_UNSIGNED_PRESET_SECURE`)**:
 *    Direct zero-Worker-CPU uploads from Android & Web with forced `fl_strip_profile` (EXIF GPS stripping!).
 * 3. **Worker-Signed Authenticated Uploads & `s--...--` Delivery URLs**: Cryptographic WebCrypto SHA-256 / SHA-1
 *    signing for `type = 'authenticated'` assets (`kyc`, `remittance`, `dispute`, `invoice_pdf`) so raw URLs return 401.
 * 4. **Free CDN Optimization Suite**: `f_auto,q_auto` AVIF/WebP delivery, `c_fill,g_auto` smart dish framing,
 *    `e_blur:1000,w_40,q_10,f_webp` LQIP placeholders, and `pg_1,f_webp,w_600` PDF page-1 thumbnails.
 */

export type CloudinaryDeliveryType = 'upload' | 'authenticated' | 'private';
export type CloudinaryResourceType = 'image' | 'raw' | 'video';

export type UndalMediaCategory =
  | 'menu_item'
  | 'vendor_logo'
  | 'vendor_cover'
  | 'profile_avatar'
  | 'banner'
  | 'review_photo'
  | 'vendor_kyc'
  | 'rider_kyc'
  | 'rider_shift_selfie'
  | 'cash_remittance_proof'
  | 'dispute_evidence'
  | 'chat_attachment'
  | 'invoice_pdf';

export interface CloudinaryEnvConfig {
  readonly cloudName: string;
  readonly unsignedPresetPublic: string;
  readonly unsignedPresetSecure?: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
}

export interface UnsignedUploadDescriptor {
  readonly endpointUrl: string;
  readonly cloudName: string;
  readonly uploadPreset: string;
  readonly folder: string;
  readonly publicIdPrefix: string;
  readonly deliveryType: CloudinaryDeliveryType;
  readonly resourceType: CloudinaryResourceType;
  readonly stripExifGps: true;
  readonly context: string;
}

export interface SignedUploadTicket {
  readonly endpointUrl: string;
  readonly cloudName: string;
  readonly apiKey: string;
  readonly timestamp: number;
  readonly folder: string;
  readonly publicId: string;
  readonly type: CloudinaryDeliveryType;
  readonly resourceType: CloudinaryResourceType;
  readonly transformation: string;
  readonly signature: string;
}

/** Strict classification separating public CDN assets from private/authenticated compliance assets. */
export function isPrivateMediaCategory(category: UndalMediaCategory): boolean {
  switch (category) {
    case 'vendor_kyc':
    case 'rider_kyc':
    case 'rider_shift_selfie':
    case 'cash_remittance_proof':
    case 'dispute_evidence':
    case 'chat_attachment':
    case 'invoice_pdf':
      return true;
    case 'menu_item':
    case 'vendor_logo':
    case 'vendor_cover':
    case 'profile_avatar':
    case 'banner':
    case 'review_photo':
      return false;
  }
}

/** Deterministic Cloudinary folder hierarchy keeping public & sensitive trees strictly isolated. */
export function resolveCloudinaryFolder(category: UndalMediaCategory, ownerEntityId: string): string {
  const cleanId = ownerEntityId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanId) {
    throw new Error('CLOUDINARY_INVALID_ENTITY_ID');
  }
  return isPrivateMediaCategory(category)
    ? `undal/private/${category}/${cleanId}`
    : `undal/public/${category}/${cleanId}`;
}

/**
 * Builds a direct client-to-Cloudinary **Unsigned Upload Preset** descriptor (`0 ms` Worker CPU!).
 * Every upload strips camera EXIF GPS coordinates (`D-24` Home Kitchen privacy protection).
 */
export function buildCloudinaryUnsignedUploadDescriptor(params: {
  readonly config: Pick<CloudinaryEnvConfig, 'cloudName' | 'unsignedPresetPublic' | 'unsignedPresetSecure'>;
  readonly category: UndalMediaCategory;
  readonly ownerEntityId: string;
  readonly clientNonce: string;
}): UnsignedUploadDescriptor {
  const isPrivate = isPrivateMediaCategory(params.category);
  const resourceType: CloudinaryResourceType = params.category === 'invoice_pdf' ? 'raw' : 'image';
  const preset = isPrivate
    ? params.config.unsignedPresetSecure ?? params.config.unsignedPresetPublic
    : params.config.unsignedPresetPublic;

  if (!params.config.cloudName || !preset) {
    throw new Error('CLOUDINARY_CONFIG_MISSING');
  }

  const cleanNonce = params.clientNonce.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (cleanNonce.length < 8) {
    throw new Error('CLOUDINARY_NONCE_TOO_SHORT');
  }

  const folder = resolveCloudinaryFolder(params.category, params.ownerEntityId);
  return {
    endpointUrl: `https://api.cloudinary.com/v1_1/${params.config.cloudName}/${resourceType}/upload`,
    cloudName: params.config.cloudName,
    uploadPreset: preset,
    folder,
    publicIdPrefix: `${params.category}_${cleanNonce}`,
    deliveryType: isPrivate ? 'authenticated' : 'upload',
    resourceType,
    stripExifGps: true,
    context: `surface=undal|category=${params.category}|exif_stripped=1`,
  };
}

/** Computes lowercase hex SHA-256 digest via WebCrypto (`Workers` + `Node 22+` + `Browser`). */
async function sha256Hex(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Computes URL-safe Base64 first-8-chars SHA-256 Cloudinary `s--XXXXXXXX--` signature token (`SHA-256` mode). */
async function cloudinaryUrlSignature8(toSign: string): Promise<string> {
  const bytes = new TextEncoder().encode(toSign);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let bin = '';
  for (const byte of digest) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
}

/**
 * Mints a server-signed **Authenticated Upload Ticket** inside `W1` / `W3` (`CLOUDINARY_API_SECRET` never leaves Worker!).
 * Locks private documents (`KYC`, `TrxID` screenshots, dispute proofs, invoice PDFs) to `type = 'authenticated'`.
 */
export async function signCloudinaryUploadTicket(params: {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly category: UndalMediaCategory;
  readonly ownerEntityId: string;
  readonly assetUuid: string;
  readonly timestampSec?: number;
}): Promise<SignedUploadTicket> {
  if (!params.cloudName || !params.apiKey || !params.apiSecret) {
    throw new Error('CLOUDINARY_SECRET_MISSING');
  }
  const timestamp = params.timestampSec ?? Math.floor(Date.now() / 1000);
  const folder = resolveCloudinaryFolder(params.category, params.ownerEntityId);
  const publicId = params.assetUuid.replace(/[^a-zA-Z0-9_-]/g, '');
  const type: CloudinaryDeliveryType = isPrivateMediaCategory(params.category) ? 'authenticated' : 'upload';
  const resourceType: CloudinaryResourceType = params.category === 'invoice_pdf' ? 'raw' : 'image';
  const transformation = resourceType === 'image' ? 'fl_strip_profile' : '';

  // Cloudinary canonical alphabetical parameter serialization (excluding api_key, file, resource_type)
  const pairs: Array<[string, string]> = [
    ['folder', folder],
    ['public_id', publicId],
    ['timestamp', String(timestamp)],
    ['type', type],
  ];
  if (transformation) {
    pairs.push(['transformation', transformation]);
  }
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const canonicalString = pairs.map(([k, v]) => `${k}=${v}`).join('&') + params.apiSecret;
  const signature = await sha256Hex(canonicalString);

  return {
    endpointUrl: `https://api.cloudinary.com/v1_1/${params.cloudName}/${resourceType}/upload`,
    cloudName: params.cloudName,
    apiKey: params.apiKey,
    timestamp,
    folder,
    publicId,
    type,
    resourceType,
    transformation,
    signature,
  };
}

/**
 * Generates an optimized public Cloudinary CDN URL (`f_auto,q_auto,fl_strip_profile` + smart crop / LQIP blur).
 */
export function buildCloudinaryPublicUrl(params: {
  readonly cloudName: string;
  readonly publicId: string;
  readonly width?: number;
  readonly height?: number;
  readonly blurPlaceholder?: boolean;
  readonly pdfPreviewPage1?: boolean;
  readonly version?: number;
}): string {
  const transforms: string[] = ['fl_strip_profile'];
  if (params.pdfPreviewPage1) {
    transforms.push('pg_1', 'f_webp', `w_${params.width ?? 600}`, 'q_auto');
  } else if (params.blurPlaceholder) {
    transforms.push('e_blur:1000', 'w_40', 'q_10', 'f_webp');
  } else {
    transforms.push('f_auto', 'q_auto');
    if (params.width && params.height) {
      transforms.push('c_fill', 'g_auto', `w_${params.width}`, `h_${params.height}`);
    } else if (params.width) {
      transforms.push('c_limit', `w_${params.width}`);
    }
  }
  const ver = params.version ? `v${params.version}/` : '';
  const cleanId = params.publicId.replace(/^\/+/, '');
  return `https://res.cloudinary.com/${params.cloudName}/image/upload/${transforms.join(',')}/${ver}${cleanId}`;
}

/**
 * Mints a signed `authenticated` Cloudinary delivery URL (`s--XXXXXXXX--`) inside `W1` / `W3`
 * after RBAC verification and mandatory `audit_logs` write (`ADR-0006`).
 */
export async function signCloudinaryAuthenticatedUrl(params: {
  readonly cloudName: string;
  readonly apiSecret: string;
  readonly publicId: string;
  readonly resourceType?: CloudinaryResourceType;
  readonly format?: string;
  readonly transformation?: string;
  readonly expiresAtUnixSec?: number;
}): Promise<string> {
  if (!params.cloudName || !params.apiSecret || !params.publicId) {
    throw new Error('CLOUDINARY_SIGN_PARAMS_MISSING');
  }
  const resourceType = params.resourceType ?? 'image';
  const cleanId = params.publicId.replace(/^\/+/, '');
  const fullTarget = params.format && !cleanId.endsWith(`.${params.format}`)
    ? `${cleanId}.${params.format}`
    : cleanId;

  const transformSegments: string[] = [];
  if (params.expiresAtUnixSec) {
    transformSegments.push(`exp_${Math.trunc(params.expiresAtUnixSec)}`);
  }
  if (params.transformation) {
    transformSegments.push(params.transformation);
  }
  const toSign = transformSegments.length > 0
    ? `${transformSegments.join('/')}/${fullTarget}`
    : fullTarget;
  const sig = await cloudinaryUrlSignature8(toSign + params.apiSecret);
  return `https://res.cloudinary.com/${params.cloudName}/${resourceType}/authenticated/s--${sig}--/${toSign}`;
}

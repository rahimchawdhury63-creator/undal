/**
 * @file workers/api/src/routes/media.ts
 * @description Enforces Undal's Strict Dual-Provider Free Storage Law (`ADR-0006` v2):
 *   1. `POST /v1/images/public`: **100% of ALL public & platform images** (`menu_item`, `vendor_logo`,
 *      `vendor_cover`, `profile_avatar`, `banner`, `review_photo`) -> magic-byte verified (`<= 5 MB`),
 *      EXIF/GPS stripped in Edge RAM (`stripImageMetadataBytes`), uploaded to **Unlimited Free ImgBB**
 *      using server secret `IMGBB_API_KEY` (`imgbb_delete_url` kept server-only!).
 *   2. `POST /v1/images/private-upload-url`: **Sensitive compliance files ONLY** (`vendor_kyc`, `rider_kyc`,
 *      `rider_shift_selfie`, `cash_remittance_proof`, `dispute_evidence`, `chat_attachment`, `invoice_pdf`) ->
 *      mints **Cloudinary Private Vault** `authenticated` upload ticket (`0` public traffic on Cloudinary!).
 *   3. `POST /v1/images/private-view-url`: Verifies owner or RBAC permission, mints `120s` SHA-256
 *      `s--XXXXXXXX--` signed Cloudinary URL, and writes a mandatory `audit_logs` record.
 */

import {
  MAX_PUBLIC_IMAGE_BYTES,
  isPrivateCloudinaryCategory,
  isPublicImgbbCategory,
  signCloudinaryAuthenticatedUrl,
  signCloudinaryUploadTicket,
  stripImageMetadataBytes,
  uploadPublicImageToImgbb,
  type SensitiveCloudinaryCategory,
} from '@undal/shared-ts';
import { requireIdempotencyKey } from '../domain-errors.ts';
import { jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal } from '../types.ts';

const DAILY_PUBLIC_UPLOAD_CAP = 30;

function requiredAdminPermissionForCategory(category: SensitiveCloudinaryCategory): string {
  switch (category) {
    case 'vendor_kyc':
    case 'rider_kyc':
    case 'rider_shift_selfie':
      return '4.pipeline';
    case 'cash_remittance_proof':
      return '5.cash_reconciliation';
    case 'invoice_pdf':
      return '5.invoices';
    case 'dispute_evidence':
    case 'chat_attachment':
      return '8.tickets';
  }
}

function decodeBase64Payload(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '').trim();
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Handles `POST /v1/images/{public,private-upload-url,private-view-url}` on `W1 undal-api`. */
export async function handleMediaRoute(
  request: Request,
  url: URL,
  env: ApiWorkerEnv,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  if (request.method !== 'POST' || !url.pathname.startsWith('/v1/images/')) {
    return null;
  }
  if (!principal) {
    return jsonErr('SESSION_EXPIRED', requestId);
  }

  // 1. ALL Public & Platform Images -> Unlimited Free ImgBB CDN ONLY
  if (url.pathname === '/v1/images/public') {
    if (principal.role === 'rider') {
      return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { reason: 'RIDERS_USE_PRIVATE_COMPLIANCE_UPLOAD' });
    }
    const usedToday = await db.countUserPublicUploadsToday(principal.sub);
    if (usedToday >= DAILY_PUBLIC_UPLOAD_CAP && principal.role !== 'admin') {
      return jsonErr('RATE_LIMITED', requestId, { daily_cap: DAILY_PUBLIC_UPLOAD_CAP });
    }

    let category = '';
    let nameSlug = 'undal-image';
    let rawBytes: Uint8Array;

    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      category = String(form.get('category') ?? '').trim();
      nameSlug = String(form.get('name') ?? 'undal-image').trim() || 'undal-image';
      const file = form.get('file');
      if (!(file instanceof File)) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'file' });
      }
      if (file.size > MAX_PUBLIC_IMAGE_BYTES) {
        return jsonErr('DOC_TOO_LARGE', requestId, { max_bytes: MAX_PUBLIC_IMAGE_BYTES });
      }
      rawBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = (await request.json().catch(() => null)) as {
        readonly category?: string;
        readonly name?: string;
        readonly image_base64?: string;
      } | null;
      if (!body?.category || !body.image_base64) {
        return jsonErr('VALIDATION_FAILED', requestId, { required: ['category', 'image_base64'] });
      }
      category = body.category.trim();
      nameSlug = (body.name ?? 'undal-image').trim() || 'undal-image';
      try {
        rawBytes = decodeBase64Payload(body.image_base64);
      } catch {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'image_base64' });
      }
    }

    if (!isPublicImgbbCategory(category)) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        category,
        hint: 'Public ImgBB endpoint accepts ONLY public platform categories; sensitive compliance files must call /v1/images/private-upload-url (Cloudinary).',
      });
    }
    if (rawBytes.byteLength > MAX_PUBLIC_IMAGE_BYTES) {
      return jsonErr('DOC_TOO_LARGE', requestId, { max_bytes: MAX_PUBLIC_IMAGE_BYTES });
    }

    let verified;
    try {
      verified = stripImageMetadataBytes(rawBytes, MAX_PUBLIC_IMAGE_BYTES);
    } catch {
      return jsonErr('VALIDATION_FAILED', requestId, { reason: 'INVALID_IMAGE_MAGIC_BYTES' });
    }

    if (!env.IMGBB_API_KEY) {
      return jsonErr('IMAGE_UPLOAD_FAILED', requestId, { reason: 'IMGBB_NOT_CONFIGURED' });
    }

    let uploaded;
    try {
      uploaded = await uploadPublicImageToImgbb({
        apiKey: env.IMGBB_API_KEY,
        category,
        cleanBytes: verified.cleanBytes,
        nameSlug,
        fetchImpl: env.__fetchImpl,
      });
    } catch {
      return jsonErr('IMAGE_UPLOAD_FAILED', requestId);
    }

    const stored = await db.insertMediaAsset({
      ownerProfileId: principal.sub,
      provider: 'imgbb',
      category,
      deliveryType: 'upload',
      cloudinaryPublicId: uploaded.externalId,
      publicCdnUrl: uploaded.url,
      mediumUrl: uploaded.mediumUrl,
      thumbUrl: uploaded.thumbUrl,
      imgbbDeleteUrl: uploaded.deleteUrl,
      bytes: uploaded.bytes,
      width: uploaded.width,
      height: uploaded.height,
      format: uploaded.format,
    });

    // Note: `imgbb_delete_url` is NEVER included in client response (`ADR-0006` security rule)
    return jsonOk(
      {
        id: stored.id,
        provider: 'imgbb',
        category: stored.category,
        url: uploaded.url,
        medium_url: uploaded.mediumUrl,
        thumb_url: uploaded.thumbUrl,
        width: uploaded.width,
        height: uploaded.height,
        bytes: uploaded.bytes,
        exif_stripped_segments: verified.strippedMetadataSegments,
      },
      requestId,
      201,
    );
  }

  // 2. Sensitive Compliance Media ONLY -> Cloudinary Private Vault
  if (url.pathname === '/v1/images/private-upload-url') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const body = (await request.json().catch(() => null)) as {
      readonly category?: string;
      readonly bytes?: number;
      readonly format?: string;
    } | null;
    const category = body?.category?.trim() ?? '';
    if (!isPrivateCloudinaryCategory(category)) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        category,
        hint: 'Cloudinary private vault accepts ONLY sensitive compliance categories; public images must call /v1/images/public (Unlimited ImgBB).',
      });
    }
    const maxBytes = category === 'invoice_pdf' ? 10 * 1024 * 1024 : MAX_PUBLIC_IMAGE_BYTES;
    const declaredBytes = Number(body?.bytes ?? 1024);
    if (!Number.isInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > maxBytes) {
      return jsonErr('DOC_TOO_LARGE', requestId, { max_bytes: maxBytes });
    }
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      return jsonErr('IMAGE_UPLOAD_FAILED', requestId, { reason: 'CLOUDINARY_SIGNED_UPLOAD_NOT_CONFIGURED' });
    }

    let ticket: Awaited<ReturnType<typeof signCloudinaryUploadTicket>>;
    try {
      ticket = await signCloudinaryUploadTicket({
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
        category,
        ownerId: principal.sub,
        assetUuid: crypto.randomUUID(),
      });
    } catch {
      return jsonErr('IMAGE_UPLOAD_FAILED', requestId, { reason: 'CLOUDINARY_TICKET_FAILED' });
    }
    const stored = await db.insertMediaAsset({
      ownerProfileId: principal.sub,
      provider: 'cloudinary',
      category,
      deliveryType: 'authenticated',
      cloudinaryPublicId: ticket.publicId,
      publicCdnUrl: null,
      mediumUrl: null,
      thumbUrl: null,
      imgbbDeleteUrl: null,
      bytes: declaredBytes,
      width: null,
      height: null,
      format: body?.format?.slice(0, 12) ?? null,
    });
    await db.insertAuditLog({
      actorId: principal.sub,
      actorRole: principal.role,
      action: 'media.private_upload_ticket',
      entityType: 'media_asset',
      entityId: stored.id,
      diff: {
        category,
        provider: 'cloudinary',
        delivery_type: 'authenticated',
        expires_at_epoch: ticket.timestamp + ticket.expiresInSeconds,
      },
      requestId,
    });

    return jsonOk(
      {
        asset_id: stored.id,
        provider: 'cloudinary',
        category,
        public_id: ticket.publicId,
        ticket,
      },
      requestId,
      201,
      { 'Cache-Control': 'private, no-store' },
    );
  }

  // 3. Audited Short-Lived (`120s`) Signed Cloudinary View URL
  if (url.pathname === '/v1/images/private-view-url') {
    const body = (await request.json().catch(() => null)) as {
      readonly asset_id?: string;
      readonly pdf_thumbnail?: boolean;
    } | null;
    if (!body?.asset_id) {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['asset_id'] });
    }
    const asset = await db.getMediaAssetById(body.asset_id);
    if (!asset || asset.provider !== 'cloudinary' || !isPrivateCloudinaryCategory(asset.category)) {
      return jsonErr('VALIDATION_FAILED', requestId, { reason: 'PRIVATE_ASSET_NOT_FOUND' });
    }

    const isOwner = asset.owner_profile_id === principal.sub;
    const isPermittedAdmin =
      !isOwner &&
      principal.role === 'admin' &&
      (await db.hasAdminPermission(principal.sub, requiredAdminPermissionForCategory(asset.category)));

    if (!isOwner && !isPermittedAdmin) {
      return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    }
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_SECRET) {
      return jsonErr('SERVER_BUSY', requestId, { reason: 'CLOUDINARY_SIGNING_UNAVAILABLE' });
    }

    const signed = await signCloudinaryAuthenticatedUrl({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiSecret: env.CLOUDINARY_API_SECRET,
      publicId: asset.cloudinary_public_id,
      ttlSeconds: 120,
      pdfPageThumbnail: Boolean(body.pdf_thumbnail),
    });

    await db.insertAuditLog({
      actorId: principal.sub,
      actorRole: principal.role,
      action: 'media.private_view',
      entityType: 'media_asset',
      entityId: asset.id,
      diff: {
        category: asset.category,
        access_basis: isOwner ? 'owner' : 'admin_rbac',
        expires_at_epoch: signed.expiresAtEpochSeconds,
      },
      requestId,
    });

    return jsonOk(
      {
        asset_id: asset.id,
        category: asset.category,
        signed_url: signed.signedUrl,
        expires_at_epoch: signed.expiresAtEpochSeconds,
      },
      requestId,
      200,
      { 'Cache-Control': 'private, no-store' },
    );
  }

  return null;
}

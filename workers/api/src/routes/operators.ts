/**
 * @file workers/api/src/routes/operators.ts
 * @description Self-service Partner (`/v1/partner/*` backing `p-03..p-37`) and Rider (`/v1/rider/*`
 * backing `r-02..r-25`) mutations & summaries on `W1 undal-api` (`Build Response 7`):
 *   - Strict `ADR-0006 v2` media enforcement: public storefront/menu images MUST be Unlimited Free
 *     ImgBB (`https://i.ibb.co/*`), while KYC & COD remittance screenshots MUST be Cloudinary Private Vault (`undal/private/*`).
 *   - Strict `0008` RBAC isolation: `vendor_staff` (`staff`) is redacted from payout account fields.
 */

import { requireIdempotencyKey } from '../domain-errors.ts';
import { jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, AuthPrincipal } from '../types.ts';

const BD_LOCAL_PHONE_RE = /^01[3-9][0-9]{8}$/;

function assertImgbbOptionalUrl(val: unknown): boolean {
  return val === undefined || val === null || (typeof val === 'string' && val.startsWith('https://i.ibb.co/'));
}

/** Handles `/v1/partner/*` and `/v1/rider/*` self-service endpoints on `W1 undal-api`. */
export async function handleOperatorsRoute(
  request: Request,
  url: URL,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/v1/partner/') && !path.startsWith('/v1/rider/')) return null;
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  /* --- 1. Partner Self-Service (`/v1/partner/*`) --- */
  if (path.startsWith('/v1/partner/')) {
    const op = await db.getOperatorVendor(principal.sub);
    if (!op) return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    const vendorId = String(op.vendor.id);
    const isOwnerOrManager = op.operatorRole === 'owner' || op.operatorRole === 'manager';

    if (path === '/v1/partner/store' && request.method === 'GET') {
      const { payout_account_enc: _enc, payout_method, payout_holder_name, payout_masked, ...safeVendor } = op.vendor;
      return jsonOk(
        {
          vendor: op.operatorRole === 'owner'
            ? { ...safeVendor, payout_method, payout_holder_name, payout_masked }
            : safeVendor,
          operator_role: op.operatorRole,
        },
        requestId,
        200,
        { 'Cache-Control': 'private, no-store' },
      );
    }

    if (path === '/v1/partner/store' && request.method === 'PATCH') {
      if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return jsonErr('VALIDATION_FAILED', requestId);
      if (!assertImgbbOptionalUrl(body.logo_url) || !assertImgbbOptionalUrl(body.cover_url)) {
        return jsonErr('VALIDATION_FAILED', requestId, {
          hint: 'Store logo_url and cover_url must use Unlimited Free ImgBB CDN URLs (https://i.ibb.co/*).',
        });
      }
      const patch: Record<string, unknown> = {};
      if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
      if (typeof body.busy_mode_extra_minutes === 'number' && [0, 10, 15, 20].includes(body.busy_mode_extra_minutes)) {
        patch.busy_mode_extra_minutes = body.busy_mode_extra_minutes;
      }
      if (isOwnerOrManager) {
        if (typeof body.accepts_pickup === 'boolean') patch.accepts_pickup = body.accepts_pickup;
        if (typeof body.min_order_poisha === 'number' && Number.isInteger(body.min_order_poisha) && body.min_order_poisha >= 0) {
          patch.min_order_poisha = body.min_order_poisha;
        }
        if (body.logo_url !== undefined) patch.logo_url = body.logo_url;
        if (body.cover_url !== undefined) patch.cover_url = body.cover_url;
      }
      const updated = await db.updateOperatorVendor(vendorId, patch);
      const { payout_account_enc: _enc, ...clean } = updated;
      return jsonOk({ vendor: clean }, requestId);
    }

    const catIdMatch = /^\/v1\/partner\/menu\/categories(?:\/([0-9a-f-]{36}))?$/i.exec(path);
    if (catIdMatch && (request.method === 'POST' || request.method === 'PATCH')) {
      if (!isOwnerOrManager) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
      if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
      const body = (await request.json().catch(() => null)) as {
        readonly name_en?: string;
        readonly name_bn?: string | null;
        readonly sort?: number;
        readonly is_active?: boolean;
      } | null;
      if (!body?.name_en || body.name_en.trim().length < 2) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'name_en' });
      }
      const category = await db.upsertMenuCategory(vendorId, catIdMatch[1] ?? null, {
        name_en: body.name_en.trim(),
        name_bn: typeof body.name_bn === 'string' ? body.name_bn.trim() : null,
        sort: typeof body.sort === 'number' && Number.isInteger(body.sort) ? body.sort : 0,
        is_active: body.is_active !== false,
      });
      return jsonOk({ category }, requestId, catIdMatch[1] ? 200 : 201);
    }

    const itemIdMatch = /^\/v1\/partner\/menu\/items(?:\/([0-9a-f-]{36}))?$/i.exec(path);
    if (itemIdMatch && (request.method === 'POST' || request.method === 'PATCH')) {
      if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return jsonErr('VALIDATION_FAILED', requestId);
      if (!assertImgbbOptionalUrl(body.image_url)) {
        return jsonErr('VALIDATION_FAILED', requestId, {
          field: 'image_url',
          hint: 'Menu item image_url must use Unlimited Free ImgBB CDN URLs (https://i.ibb.co/*).',
        });
      }
      if (!itemIdMatch[1]) {
        if (!isOwnerOrManager) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
        if (
          typeof body.category_id !== 'string' ||
          typeof body.name_en !== 'string' ||
          typeof body.price_poisha !== 'number' ||
          !Number.isInteger(body.price_poisha) ||
          body.price_poisha < 0
        ) {
          return jsonErr('VALIDATION_FAILED', requestId, { required: ['category_id', 'name_en', 'price_poisha'] });
        }
      }
      const item = await db.upsertMenuItem(vendorId, itemIdMatch[1] ?? null, body);
      return jsonOk({ item }, requestId, itemIdMatch[1] ? 200 : 201);
    }

    if (path === '/v1/partner/kyc/documents' && request.method === 'POST') {
      if (op.operatorRole !== 'owner') return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
      if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
      const body = (await request.json().catch(() => null)) as {
        readonly asset_id?: string;
        readonly doc_type?: string;
        readonly expires_on?: string | null;
        readonly issued_on?: string | null;
      } | null;
      if (!body?.doc_type || !body.asset_id) return jsonErr('VALIDATION_FAILED', requestId, { required: ['doc_type', 'asset_id'] });
      const asset = await db.getMediaAssetById(body.asset_id);
      const allowedTypes = new Set(['trade_license', 'nid_front', 'nid_back', 'passport_front', 'passport_back', 'tin', 'bin', 'bank_proof', 'bkash_proof', 'nagad_proof', 'utility_bill', 'kitchen_hygiene_photo', 'menu_doc', 'selfie']);
      if (
        !allowedTypes.has(body.doc_type) || !asset || asset.owner_profile_id !== principal.sub ||
        asset.provider !== 'cloudinary' || asset.category !== 'vendor_kyc' || asset.delivery_type !== 'authenticated' ||
        !asset.cloudinary_public_id.startsWith(`undal/private/vendor_kyc/${principal.sub}/`)
      ) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { reason: 'KYC_ASSET_OWNER_OR_PROVIDER_MISMATCH' });
      const doc = await db.submitVendorKycDoc(vendorId, body.doc_type, asset.cloudinary_public_id, body.expires_on ?? null, asset.id, body.issued_on ?? null);
      const { storage_path: _privatePath, ...safeDoc } = doc;
      await db.insertAuditLog({ actorId: principal.sub, actorRole: principal.role, action: 'partner.kyc.document.upload', entityType: 'vendor_document', entityId: String(doc.id ?? vendorId), diff: { vendor_id: vendorId, doc_type: body.doc_type, asset_id: asset.id }, requestId });
      return jsonOk({ document: safeDoc }, requestId, 201, { 'Cache-Control': 'private, no-store' });
    }

    if (path === '/v1/partner/finance/summary' && request.method === 'GET') {
      const summary = await db.getVendorFinanceSummary(vendorId, op.operatorRole === 'owner');
      return jsonOk(summary, requestId, 200, { 'Cache-Control': 'private, no-store' });
    }

    return null;
  }

  /* --- 2. Rider Self-Service (`/v1/rider/*`) --- */
  if (path === '/v1/rider/me' && request.method === 'GET') {
    const data = await db.getRiderSelfProfile(principal.sub);
    if (!data) return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    return jsonOk(data, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/v1/rider/kyc/documents' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const body = (await request.json().catch(() => null)) as {
      readonly doc_type?: string;
      readonly storage_path?: string;
      readonly expires_on?: string | null;
    } | null;
    if (!body?.doc_type || !body.storage_path?.startsWith('undal/private/rider_kyc/')) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        field: 'storage_path',
        hint: 'Rider KYC documents must be uploaded to Cloudinary Private Vault (undal/private/rider_kyc/*).',
      });
    }
    const doc = await db.submitRiderKycDoc(principal.sub, body.doc_type, body.storage_path, body.expires_on ?? null);
    return jsonOk({ document: doc }, requestId, 201);
  }

  if (path === '/v1/rider/remittances' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const body = (await request.json().catch(() => null)) as {
      readonly method?: 'bkash' | 'nagad' | 'bank';
      readonly amount_poisha?: number;
      readonly bkash_trxid?: string;
      readonly sender_number?: string;
      readonly sender_name?: string | null;
      readonly screenshot_public_id?: string;
      readonly selfie_public_id?: string | null;
    } | null;

    if (
      !body ||
      (body.method !== 'bkash' && body.method !== 'nagad' && body.method !== 'bank') ||
      typeof body.amount_poisha !== 'number' ||
      !Number.isInteger(body.amount_poisha) ||
      body.amount_poisha <= 0 ||
      !body.bkash_trxid ||
      body.bkash_trxid.trim().length < 5 ||
      !body.sender_number ||
      !BD_LOCAL_PHONE_RE.test(body.sender_number.trim()) ||
      !body.screenshot_public_id?.startsWith('undal/private/cash_remittance_proof/')
    ) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        required: ['method', 'amount_poisha', 'bkash_trxid', 'sender_number(01XXXXXXXXX)', 'screenshot_public_id'],
      });
    }

    const remittance = await db.submitRiderRemittance({
      profileId: principal.sub,
      method: body.method,
      amountPoisha: body.amount_poisha,
      bkashTrxid: body.bkash_trxid.trim(),
      senderNumber: body.sender_number.trim(),
      senderName: typeof body.sender_name === 'string' ? body.sender_name.trim() : null,
      screenshotPublicId: body.screenshot_public_id.trim(),
      selfiePublicId: typeof body.selfie_public_id === 'string' ? body.selfie_public_id.trim() : null,
    });
    return jsonOk({ remittance }, requestId, 201);
  }

  if (path === '/v1/rider/finance/summary' && request.method === 'GET') {
    const summary = await db.getRiderFinanceSummary(principal.sub);
    if (!summary) return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    return jsonOk(summary, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  return null;
}

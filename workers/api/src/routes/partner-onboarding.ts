/**
 * @file workers/api/src/routes/partner-onboarding.ts
 * @description W1-owned Partner draft, cuisine, KYC-vault, hours, payout, and submission routes (`p-01..p-07`).
 * Owners receive only their private application; Cloudinary assets are owner-bound, public zones authoritative,
 * schedules are checked server-side, and W1 RSA-OAEP encrypts payouts using a public key while W3 alone decrypts.
 */

import { jsonErr, jsonOk } from '../http.ts';
import { requireIdempotencyKey } from '../domain-errors.ts';
import type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal, VendorApplicationHoursInput } from '../types.ts';
import {
  BANK_ACCOUNT_RE,
  MFS_PHONE_RE,
  TERMS_EN,
  TERMS_HASH,
  TERMS_VERSION,
  TERMS_BN,
  TIME_RE,
  VENDOR_TYPES,
  allowedDocumentTypes,
  applicationResponse,
  dateOnlyString,
  draftSlug,
  encryptPayoutAccount,
  isTimestamp,
  normalizePhone,
  ownApplication,
  parseOnboardingMenu,
  shiftDuration,
  validBdPhone,
  validDate,
  validHygieneChecklist,
} from './partner-onboarding-helpers.ts';

/** Handles authenticated `/v1/partner/application*` onboarding APIs on W1. */
export async function handlePartnerOnboardingRoute(
  request: Request,
  url: URL,
  env: ApiWorkerEnv,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== '/v1/partner/cuisines' && path !== '/v1/partner/waitlist' && path !== '/v1/partner/application' && !path.startsWith('/v1/partner/application/')) return null;
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  if (path === '/v1/partner/waitlist' && request.method === 'POST') {
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body || typeof body.vendor_type !== 'string' || !VENDOR_TYPES.has(body.vendor_type) ||
      typeof body.lat !== 'number' || !Number.isFinite(body.lat) || body.lat < 20 || body.lat > 27 ||
      typeof body.lng !== 'number' || !Number.isFinite(body.lng) || body.lng < 88 || body.lng > 93 ||
      typeof body.public_area_label !== 'string' || body.public_area_label.trim().length < 2 || body.public_area_label.trim().length > 120
    ) return jsonErr('VALIDATION_FAILED', requestId, { required: ['vendor_type', 'lat', 'lng', 'public_area_label'] });
    const zone = await db.resolveZone(body.lat, body.lng);
    if (zone.in_service_area === true) {
      return jsonOk({ waitlisted: false, reason: 'ACTIVE_ZONE', zone_id: zone.zone_id ?? null }, requestId, 200, { 'Cache-Control': 'private, no-store' });
    }
    const entry = await db.createPartnerZoneWaitlist({
      profileId: principal.sub,
      idempotencyKey,
      vendorType: body.vendor_type as 'RESTAURANT' | 'HOME_KITCHEN' | 'CLOUD_KITCHEN',
      lat: body.lat,
      lng: body.lng,
      publicAreaLabel: body.public_area_label.trim(),
    });
    await db.insertAuditLog({
      actorId: principal.sub, actorRole: principal.role, action: 'partner.zone_waitlist.create',
      entityType: 'partner_zone_waitlist', entityId: String(entry.id ?? principal.sub),
      diff: { vendor_type: body.vendor_type, reason: 'outside_active_service_zone' }, requestId,
    });
    return jsonOk({ waitlisted: true, request_id: entry.id ?? null }, requestId, 201, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/v1/partner/cuisines' && request.method === 'GET') {
    return jsonOk({ cuisines: await db.listActiveCuisines() }, requestId, 200, { 'Cache-Control': 'private, max-age=300' });
  }
  if (path === '/v1/partner/application/terms' && request.method === 'GET') {
    return jsonOk({ version: TERMS_VERSION, sha256: TERMS_HASH, text_en: TERMS_EN, text_bn: TERMS_BN }, requestId, 200, { 'Cache-Control': 'public, max-age=3600' });
  }

  if (path === '/v1/partner/application' && request.method === 'GET') {
    return applicationResponse(await ownApplication(db, principal.sub), requestId);
  }

  if (path === '/v1/partner/application' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const existing = await ownApplication(db, principal.sub);
    if (existing) return applicationResponse(existing, requestId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const legalName = typeof body?.legal_name === 'string' ? body.legal_name.trim() : '';
    const brandName = typeof body?.brand_name === 'string' ? body.brand_name.trim() : '';
    const representativeName = typeof body?.representative_name === 'string' ? body.representative_name.trim() : '';
    const contactEmail = typeof body?.contact_email === 'string' ? body.contact_email.trim().toLowerCase() : '';
    const cuisines = body?.cuisines;
    const acceptsPickup = body?.accepts_pickup === true || (body?.accepts_pickup === undefined && body?.type === 'RESTAURANT');
    if (
      !body || typeof body.type !== 'string' || !VENDOR_TYPES.has(body.type) ||
      legalName.length < 2 || legalName.length > 140 || brandName.length < 2 || brandName.length > 120 ||
      representativeName.length < 2 || representativeName.length > 140 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ||
      !validBdPhone(body.counter_phone) ||
      typeof body.public_area_label !== 'string' || body.public_area_label.trim().length < 2 || body.public_area_label.trim().length > 120 ||
      typeof body.address_text_private !== 'string' || body.address_text_private.trim().length < 4 || body.address_text_private.trim().length > 400 ||
      typeof body.lat !== 'number' || !Number.isFinite(body.lat) || body.lat < 20 || body.lat > 27 ||
      typeof body.lng !== 'number' || !Number.isFinite(body.lng) || body.lng < 88 || body.lng > 93 ||
      (cuisines !== undefined && (!Array.isArray(cuisines) || cuisines.length > 5 || !cuisines.every((x) => typeof x === 'string' && /^[a-z][a-z0-9_]{1,48}$/.test(x)))) ||
      (body.accepts_pickup !== undefined && typeof body.accepts_pickup !== 'boolean') ||
      (acceptsPickup && (typeof body.pickup_point_label !== 'string' || body.pickup_point_label.trim().length < 2 || body.pickup_point_label.trim().length > 120)) ||
      (body.pickup_point_label !== undefined && body.pickup_point_label !== null && (typeof body.pickup_point_label !== 'string' || body.pickup_point_label.trim().length > 120))
    ) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        required: ['type', 'legal_name', 'brand_name', 'representative_name', 'contact_email', 'counter_phone', 'public_area_label', 'address_text_private', 'lat', 'lng'],
      });
    }
    const zone = await db.resolveZone(body.lat, body.lng);
    if (zone.in_service_area !== true || typeof zone.zone_id !== 'string') {
      return jsonErr('OUTSIDE_ZONE', requestId, {
        nearest_zone_slug: zone.nearest_zone_slug ?? null,
        nearest_distance_km: zone.nearest_distance_km ?? null,
      });
    }
    const created = await db.createVendorApplication({
      ownerProfileId: principal.sub,
      type: body.type as 'RESTAURANT' | 'HOME_KITCHEN' | 'CLOUD_KITCHEN',
      legalName,
      brandName,
      brandNameBn: typeof body.brand_name_bn === 'string' ? body.brand_name_bn.trim().slice(0, 120) : null,
      representativeName,
      contactEmail,
      slug: draftSlug(brandName),
      counterPhone: normalizePhone(body.counter_phone as string),
      publicAreaLabel: (body.public_area_label as string).trim(),
      addressTextPrivate: (body.address_text_private as string).trim(),
      lat: body.lat,
      lng: body.lng,
      zoneId: zone.zone_id,
      cuisines: (cuisines as string[] | undefined) ?? [],
      acceptsPickup,
      pickupPointLabel: typeof body.pickup_point_label === 'string' ? body.pickup_point_label.trim() : null,
    });
    const application = typeof created.id === 'string' ? await ownApplication(db, principal.sub) : created;
    return applicationResponse(application, requestId, 201);
  }

  if (path === '/v1/partner/application' && request.method === 'PATCH') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const current = await ownApplication(db, principal.sub);
    if (!current || typeof current.id !== 'string') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    if (current.kyc_status !== 'draft' && current.kyc_status !== 'needs_fix') return jsonErr('ORDER_STATE_ILLEGAL', requestId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonErr('VALIDATION_FAILED', requestId);
    const patch: Record<string, unknown> = {};
    const textFields: ReadonlyArray<readonly [string, string, number, number]> = [
      ['legal_name', 'legal_name', 2, 140], ['brand_name', 'brand_name', 2, 120],
      ['representative_name', 'representative_name', 2, 140], ['public_area_label', 'public_area_label', 2, 120],
      ['address_text_private', 'address_text_private', 4, 400],
    ];
    for (const [field, column, min, max] of textFields) {
      if (body[field] === undefined) continue;
      if (typeof body[field] !== 'string' || body[field].trim().length < min || body[field].trim().length > max) {
        return jsonErr('VALIDATION_FAILED', requestId, { field });
      }
      patch[column] = body[field].trim();
    }
    if (body.brand_name_bn !== undefined) {
      if (body.brand_name_bn !== null && typeof body.brand_name_bn !== 'string') return jsonErr('VALIDATION_FAILED', requestId, { field: 'brand_name_bn' });
      patch.brand_name_bn = typeof body.brand_name_bn === 'string' ? body.brand_name_bn.trim().slice(0, 120) : null;
    }
    if (body.contact_email !== undefined) {
      const email = typeof body.contact_email === 'string' ? body.contact_email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonErr('VALIDATION_FAILED', requestId, { field: 'contact_email' });
      patch.contact_email = email;
    }
    if (body.counter_phone !== undefined) {
      if (!validBdPhone(body.counter_phone)) return jsonErr('PHONE_INVALID_BD', requestId);
      patch.counter_phone = normalizePhone(body.counter_phone as string);
    }
    if (body.public_area_label === undefined && body.address_text_private !== undefined && typeof body.lat !== 'number') {
      // Address changes may be private-only; no public label is synthesized from an exact home address.
    }
    if (body.lat !== undefined || body.lng !== undefined) {
      const lat = typeof body.lat === 'number' ? body.lat : Number(current.lat);
      const lng = typeof body.lng === 'number' ? body.lng : Number(current.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 27 || lng < 88 || lng > 93) return jsonErr('LOCATION_REQUIRED', requestId);
      const zone = await db.resolveZone(lat, lng);
      if (zone.in_service_area !== true || typeof zone.zone_id !== 'string') return jsonErr('OUTSIDE_ZONE', requestId);
      patch.lat = lat;
      patch.lng = lng;
      patch.zone_id = zone.zone_id;
    }
    if (body.cuisines !== undefined) {
      if (!Array.isArray(body.cuisines) || body.cuisines.length > 5 || !body.cuisines.every((x) => typeof x === 'string' && /^[a-z][a-z0-9_]{1,48}$/.test(x))) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'cuisines' });
      }
      patch.cuisines = body.cuisines;
    }
    if (body.accepts_pickup !== undefined) {
      if (typeof body.accepts_pickup !== 'boolean') return jsonErr('VALIDATION_FAILED', requestId, { field: 'accepts_pickup' });
      const candidateLabel = typeof body.pickup_point_label === 'string' ? body.pickup_point_label.trim() : String(current.pickup_point_label ?? '').trim();
      if (body.accepts_pickup && (candidateLabel.length < 2 || candidateLabel.length > 120)) return jsonErr('VALIDATION_FAILED', requestId, { field: 'pickup_point_label' });
      patch.accepts_pickup = body.accepts_pickup;
    }
    if (body.pickup_point_label !== undefined) {
      if (body.pickup_point_label !== null && (typeof body.pickup_point_label !== 'string' || body.pickup_point_label.trim().length < 2 || body.pickup_point_label.trim().length > 120)) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'pickup_point_label' });
      }
      patch.pickup_point_label = typeof body.pickup_point_label === 'string' ? body.pickup_point_label.trim() : null;
    }
    if (body.onboarding_menu !== undefined) {
      const menu = parseOnboardingMenu(body.onboarding_menu);
      if (!menu) return jsonErr('VALIDATION_FAILED', requestId, { field: 'onboarding_menu', money_unit: 'poisha_integer' });
      patch.onboarding_menu = menu;
    }
    if (body.on_demand_declared !== undefined) {
      if (typeof body.on_demand_declared !== 'boolean') return jsonErr('VALIDATION_FAILED', requestId, { field: 'on_demand_declared' });
      patch.on_demand_declared = body.on_demand_declared;
    }
    if (body.typical_prep_minutes !== undefined) {
      if (current.type === 'RESTAURANT' || typeof body.typical_prep_minutes !== 'number' || !Number.isInteger(body.typical_prep_minutes) || body.typical_prep_minutes < 5 || body.typical_prep_minutes > 200) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'typical_prep_minutes', minimum: 5, maximum: 200 });
      }
      patch.partner_prep_minutes_estimate = body.typical_prep_minutes;
    }
    if (body.hygiene_checklist !== undefined) {
      if (!validHygieneChecklist(body.hygiene_checklist)) return jsonErr('VALIDATION_FAILED', requestId, { field: 'hygiene_checklist' });
      patch.hygiene_checklist = body.hygiene_checklist;
    }
    if (body.packaging_standard_accepted !== undefined) {
      if (typeof body.packaging_standard_accepted !== 'boolean') return jsonErr('VALIDATION_FAILED', requestId, { field: 'packaging_standard_accepted' });
      patch.packaging_standard_accepted_at = body.packaging_standard_accepted ? new Date().toISOString() : null;
    }
    let acceptedTerms = false;
    if (body.accepted_terms !== undefined) {
      if (typeof body.accepted_terms !== 'boolean') return jsonErr('VALIDATION_FAILED', requestId, { field: 'accepted_terms' });
      if (body.accepted_terms) {
        if (body.agreement_version !== TERMS_VERSION) return jsonErr('VALIDATION_FAILED', requestId, { field: 'agreement_version' });
        patch.partner_agreement_version = TERMS_VERSION;
        patch.partner_agreement_hash = TERMS_HASH;
        patch.partner_agreement_accepted_at = new Date().toISOString();
        patch.partner_agreement_accepted_by = principal.sub;
        acceptedTerms = true;
      } else {
        patch.partner_agreement_version = null;
        patch.partner_agreement_hash = null;
        patch.partner_agreement_accepted_at = null;
        patch.partner_agreement_accepted_by = null;
      }
    }
    if (Object.keys(patch).length === 0) return jsonErr('VALIDATION_FAILED', requestId, { reason: 'NO_EDITABLE_FIELDS' });
    const updated = await db.updateVendorApplication(principal.sub, current.id, patch);
    if (!updated) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    if (acceptedTerms) {
      await db.insertAuditLog({
        actorId: principal.sub, actorRole: principal.role, action: 'partner.agreement.accept',
        entityType: 'vendor', entityId: current.id,
        diff: { agreement_version: TERMS_VERSION, terms_sha256: TERMS_HASH }, requestId,
      });
    }
    return applicationResponse(await ownApplication(db, principal.sub), requestId);
  }

  if (path === '/v1/partner/application/documents' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const current = await ownApplication(db, principal.sub);
    if (!current || typeof current.id !== 'string') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    if (current.kyc_status !== 'draft' && current.kyc_status !== 'needs_fix') return jsonErr('ORDER_STATE_ILLEGAL', requestId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (typeof body?.doc_type !== 'string' || !allowedDocumentTypes(current.type).has(body.doc_type) || typeof body.asset_id !== 'string') {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['doc_type', 'asset_id'] });
    }
    const currentDocuments = Array.isArray(current.documents) ? current.documents.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
    const latestDocument = currentDocuments.find((document) => document.doc_type === body.doc_type);
    if (latestDocument?.review_status === 'approved') {
      return jsonErr('ORDER_STATE_ILLEGAL', requestId, { reason: 'APPROVED_KYC_DOCUMENT_LOCKED', doc_type: body.doc_type });
    }
    const asset = await db.getMediaAssetById(body.asset_id);
    const expectedFolder = `undal/private/vendor_kyc/${principal.sub}/`;
    if (
      !asset || asset.owner_profile_id !== principal.sub || asset.provider !== 'cloudinary' ||
      asset.category !== 'vendor_kyc' || asset.delivery_type !== 'authenticated' ||
      !asset.cloudinary_public_id.startsWith(expectedFolder)
    ) {
      return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { reason: 'KYC_ASSET_OWNER_OR_PROVIDER_MISMATCH' });
    }
    const expiresOn = body.expires_on === undefined || body.expires_on === null ? null : body.expires_on;
    const issuedOn = body.issued_on === undefined || body.issued_on === null ? null : body.issued_on;
    if ((expiresOn !== null && !validDate(expiresOn)) || (issuedOn !== null && !validDate(issuedOn))) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'document_dates' });
    }
    if (body.doc_type === 'trade_license' && expiresOn === null) return jsonErr('VALIDATION_FAILED', requestId, { field: 'expires_on' });
    if (body.doc_type === 'utility_bill' && issuedOn === null) return jsonErr('VALIDATION_FAILED', requestId, { field: 'issued_on' });
    const document = await db.submitVendorKycDoc(current.id, body.doc_type, asset.cloudinary_public_id, expiresOn as string | null, asset.id, issuedOn as string | null);
    const { storage_path: _privatePath, ...safeDocument } = document;
    await db.insertAuditLog({
      actorId: principal.sub, actorRole: principal.role, action: 'partner.kyc.document.upload',
      entityType: 'vendor_document', entityId: String(document.id ?? current.id),
      diff: { vendor_id: current.id, doc_type: body.doc_type, asset_id: asset.id }, requestId,
    });
    return jsonOk({ document: safeDocument }, requestId, 201, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/v1/partner/application/hours' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const current = await ownApplication(db, principal.sub);
    if (!current || typeof current.id !== 'string') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    if (current.kyc_status !== 'draft' && current.kyc_status !== 'needs_fix') return jsonErr('ORDER_STATE_ILLEGAL', requestId);
    const body = (await request.json().catch(() => null)) as { hours?: unknown } | null;
    if (!Array.isArray(body?.hours) || body.hours.length !== 7) return jsonErr('VALIDATION_FAILED', requestId, { field: 'hours', required_days: 7 });
    const seen = new Set<number>();
    const hours: VendorApplicationHoursInput[] = [];
    let compliantDays = 0;
    for (const raw of body.hours) {
      if (!raw || typeof raw !== 'object') return jsonErr('VALIDATION_FAILED', requestId, { field: 'hours' });
      const row = raw as Record<string, unknown>;
      const weekday = Number(row.weekday);
      const isClosed = row.is_closed === true;
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday) || typeof row.is_closed !== 'boolean') {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'hours.weekday' });
      }
      seen.add(weekday);
      if (isClosed) {
        hours.push({ weekday, isClosed: true, open1: null, close1: null, open2: null, close2: null });
        continue;
      }
      const open1 = typeof row.open1 === 'string' ? row.open1 : '';
      const close1 = typeof row.close1 === 'string' ? row.close1 : '';
      const open2 = row.open2 === null || row.open2 === undefined || row.open2 === '' ? null : String(row.open2);
      const close2 = row.close2 === null || row.close2 === undefined || row.close2 === '' ? null : String(row.close2);
      if (!TIME_RE.test(open1) || !TIME_RE.test(close1) || ((open2 === null) !== (close2 === null)) ||
          (open2 !== null && (!TIME_RE.test(open2) || !TIME_RE.test(close2!)))) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: `hours.${weekday}` });
      }
      const span1 = shiftDuration(open1, close1);
      const span2 = open2 === null ? 0 : shiftDuration(open2, close2!);
      if (span1 === 0 || (open2 !== null && span2 === 0) || span1 + span2 > 1440) return jsonErr('VALIDATION_FAILED', requestId, { field: `hours.${weekday}` });
      if (span1 + span2 >= 240) compliantDays += 1;
      hours.push({ weekday, isClosed: false, open1, close1, open2, close2 });
    }
    if (seen.size !== 7 || compliantDays < 5) return jsonErr('VALIDATION_FAILED', requestId, { reason: 'OPENING_COMPLIANCE', minimum_hours: 4, minimum_days: 5 });
    await db.saveVendorApplicationHours(current.id, hours);
    return applicationResponse(await ownApplication(db, principal.sub), requestId);
  }

  if (path === '/v1/partner/application/payout' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const current = await ownApplication(db, principal.sub);
    if (!current || typeof current.id !== 'string') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    if (current.kyc_status !== 'draft' && current.kyc_status !== 'needs_fix') return jsonErr('ORDER_STATE_ILLEGAL', requestId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const method = body?.method;
    const holderName = typeof body?.holder_name === 'string' ? body.holder_name.trim() : '';
    const accountInput = typeof body?.account_number === 'string' ? body.account_number.trim() : '';
    const accountNumber = Array.from(accountInput, (char) => {
      const cp = char.codePointAt(0) ?? 0;
      return cp >= 0x09e6 && cp <= 0x09ef ? String(cp - 0x09e6) : char;
    }).join('').replace(/[\s-]/g, '');
    if (method !== 'bkash' && method !== 'nagad' && method !== 'bank') return jsonErr('VALIDATION_FAILED', requestId, { field: 'method' });
    if (holderName.length < 2 || holderName.length > 140) return jsonErr('VALIDATION_FAILED', requestId, { field: 'holder_name' });
    if ((method === 'bkash' || method === 'nagad') && !MFS_PHONE_RE.test(normalizePhone(accountNumber))) return jsonErr('PHONE_INVALID_BD', requestId);
    if (method === 'bank' && !BANK_ACCOUNT_RE.test(accountNumber)) return jsonErr('VALIDATION_FAILED', requestId, { field: 'account_number' });
    const normalizedAccount = method === 'bank' ? accountNumber : normalizePhone(accountNumber);
    const masked = method === 'bank' ? `••••${normalizedAccount.slice(-4)}` : `${normalizedAccount.slice(0, 3)}****${normalizedAccount.slice(-4)}`;
    const existing = current.payout && typeof current.payout === 'object' ? current.payout as Record<string, unknown> : null;
    if (existing?.method === method && existing.holder_name === holderName && existing.masked === masked) return applicationResponse(current, requestId);
    const publicKey = env.VENDOR_PAYOUT_PUBLIC_KEY_SPKI_B64?.trim() ?? '';
    if (!publicKey) return jsonErr('SERVER_BUSY', requestId, { reason: 'PAYOUT_ENCRYPTION_NOT_CONFIGURED' });
    let ciphertextHex: string;
    try {
      ciphertextHex = await encryptPayoutAccount(normalizedAccount, publicKey);
    } catch {
      return jsonErr('SERVER_BUSY', requestId, { reason: 'PAYOUT_ENCRYPTION_UNAVAILABLE' });
    }
    const payout = await db.saveVendorPayoutAccount({
      profileId: principal.sub,
      vendorId: current.id,
      method,
      holderName,
      ciphertextHex,
      masked,
    });
    await db.insertAuditLog({
      actorId: principal.sub, actorRole: principal.role, action: 'partner.payout_account.update',
      entityType: 'vendor', entityId: current.id,
      diff: { method, holder_name: holderName, masked: payout.masked ?? masked }, requestId,
    });
    return applicationResponse(await ownApplication(db, principal.sub), requestId);
  }

  if (path === '/v1/partner/application/submit' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const current = await ownApplication(db, principal.sub);
    if (!current || typeof current.id !== 'string') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    if (current.kyc_status === 'submitted' || current.kyc_status === 'under_review' || current.kyc_status === 'approved') {
      return applicationResponse(current, requestId);
    }
    if (current.kyc_status !== 'draft' && current.kyc_status !== 'needs_fix') return jsonErr('ORDER_STATE_ILLEGAL', requestId);
    const documents = Array.isArray(current.documents) ? current.documents.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')) : [];
    const latestDocs = new Map<string, Record<string, unknown>>();
    for (const doc of documents) if (!latestDocs.has(String(doc.doc_type))) latestDocs.set(String(doc.doc_type), doc);
    const availableTypes = new Set([...latestDocs.entries()].filter(([, doc]) => doc.review_status === 'pending' || doc.review_status === 'approved').map(([type]) => type));
    const requiredTypes: string[] = [];
    if (current.type === 'RESTAURANT') {
      for (const docType of ['trade_license', 'tin', 'bin']) {
        if (!availableTypes.has(docType)) requiredTypes.push(docType);
      }
    }
    const hasNidPair = availableTypes.has('nid_front') && availableTypes.has('nid_back');
    const hasPassportPair = availableTypes.has('passport_front') && availableTypes.has('passport_back');
    if (!hasNidPair && !hasPassportPair) requiredTypes.push('nid_or_passport_front_and_back');
    if (current.type !== 'RESTAURANT') {
      if (!availableTypes.has('utility_bill')) requiredTypes.push('utility_bill');
      if (!availableTypes.has('kitchen_hygiene_photo')) requiredTypes.push('kitchen_hygiene_photo');
    }
    const proofTypes = ['bank_proof', 'bkash_proof', 'nagad_proof'];
    if (!proofTypes.some((type) => availableTypes.has(type))) requiredTypes.push('bank_proof_or_bkash_or_nagad_proof');
    if (current.type === 'RESTAURANT' && !availableTypes.has('menu_doc')) requiredTypes.push('menu_doc');
    const trade = latestDocs.get('trade_license');
    const tradeExpiry = dateOnlyString(trade?.expires_on);
    if (current.type === 'RESTAURANT' && (!tradeExpiry || tradeExpiry < new Date().toISOString().slice(0, 10))) {
      requiredTypes.push('trade_license_expiry');
    }
    if (current.type !== 'RESTAURANT') {
      const utility = latestDocs.get('utility_bill');
      const issuedDate = dateOnlyString(utility?.issued_on);
      const issued = issuedDate ? new Date(`${issuedDate}T00:00:00Z`) : null;
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      if (!issued || issued.getTime() < cutoff.getTime() || issued.getTime() > Date.now()) requiredTypes.push('utility_bill_issued_within_90_days');
      if (!Array.isArray(current.onboarding_menu) || current.onboarding_menu.length === 0) requiredTypes.push('structured_menu');
      if (current.on_demand_declared !== true) requiredTypes.push('on_demand_declaration');
      if (typeof current.partner_prep_minutes_estimate !== 'number' || !Number.isInteger(current.partner_prep_minutes_estimate) || current.partner_prep_minutes_estimate < 5 || current.partner_prep_minutes_estimate > 200) requiredTypes.push('typical_prep_minutes');
      if (!validHygieneChecklist(current.hygiene_checklist)) requiredTypes.push('hygiene_checklist');
      if (!isTimestamp(current.packaging_standard_accepted_at)) requiredTypes.push('packaging_standard_acknowledgement');
    }
    const hours = Array.isArray(current.hours) ? current.hours.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')) : [];
    const compliantDays = hours.filter((day) => {
      if (day.is_closed === true || typeof day.open1 !== 'string' || typeof day.close1 !== 'string') return false;
      const span1 = shiftDuration(day.open1, day.close1);
      const span2 = typeof day.open2 === 'string' && typeof day.close2 === 'string' ? shiftDuration(day.open2, day.close2) : 0;
      return span1 + span2 >= 240;
    }).length;
    if (hours.length !== 7 || compliantDays < 5) requiredTypes.push('hours_4h_x_5days');
    const payout = current.payout && typeof current.payout === 'object' ? current.payout as Record<string, unknown> : null;
    if (!payout || typeof payout.masked !== 'string') requiredTypes.push('payout_account');
    if (current.partner_agreement_version !== TERMS_VERSION || current.partner_agreement_hash !== TERMS_HASH || !isTimestamp(current.partner_agreement_accepted_at)) {
      requiredTypes.push('partner_agreement');
    }
    if (requiredTypes.length > 0) return jsonErr('KYC_INCOMPLETE', requestId, { missing: requiredTypes });
    const updated = await db.updateVendorApplication(principal.sub, current.id, { kyc_status: 'submitted', is_active: false });
    if (!updated) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    await db.insertAuditLog({
      actorId: principal.sub, actorRole: principal.role, action: 'partner.kyc.submit',
      entityType: 'vendor', entityId: current.id,
      diff: { from: current.kyc_status, to: 'submitted', vendor_type: current.type }, requestId,
    });
    return applicationResponse(await ownApplication(db, principal.sub), requestId);
  }

  return null;
}

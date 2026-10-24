/**
 * @file workers/api/test/api-part3-partner.test.mjs
 * @description Response 16 HTTP integration tests for three Partner tracks, owner-bound KYC,
 * RSA payout encryption, zone waitlisting, completeness checks, and private-response redaction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import worker, { resetRateLimitBuckets } from '../src/index.ts';
import { TEST_JWT_SECRET, bootRealApiPostgres, createPgliteAdapter, mintTestJwt } from './_helpers/pglite-api-harness.mjs';

const PARTNER_ID = 'f1601111-1111-4111-8111-111111111111';
const RESTAURANT_ID = 'f1602222-2222-4222-8222-222222222222';
const CLOUD_ID = 'f1603333-3333-4333-8333-333333333333';
let partnerTestEnv;

async function requestJson(url, token, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await worker.fetch(new Request(`https://api.undal.app${url}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), partnerTestEnv);
  const raw = await response.text();
  return { response, json: raw.length === 0 ? {} : JSON.parse(raw), raw };
}

async function createApplication(token, track, suffix, overrides = {}) {
  const result = await requestJson('/v1/partner/application', token, {
    method: 'POST',
    idempotencyKey: `partner-create-${suffix}`,
    body: {
      type: track,
      legal_name: `${track} Legal Name`,
      brand_name: `${track} Kitchen`,
      representative_name: 'Applicant Legal Name',
      contact_email: `${suffix}@undal.test`,
      counter_phone: '01716000011',
      public_area_label: 'Zindabazar, Sylhet',
      address_text_private: 'Private kitchen address, owner only',
      lat: 24.8949,
      lng: 91.8687,
      cuisines: ['homemade'],
      ...overrides,
    },
  });
  assert.equal(result.response.status, 201, result.raw);
  assert.equal(result.json.data.application.type, track);
  return result.json.data.application;
}

async function uploadAndBind(token, suffix, docType, dates = {}) {
  const ticket = await requestJson('/v1/images/private-upload-url', token, {
    method: 'POST',
    idempotencyKey: `ticket-${suffix}-${docType}`,
    body: { category: 'vendor_kyc', bytes: 2048, format: 'jpg' },
  });
  assert.equal(ticket.response.status, 201, ticket.raw);
  assert.equal(ticket.json.data.provider, 'cloudinary');
  const bound = await requestJson('/v1/partner/application/documents', token, {
    method: 'POST',
    idempotencyKey: `document-${suffix}-${docType}`,
    body: { asset_id: ticket.json.data.asset_id, doc_type: docType, ...dates },
  });
  assert.equal(bound.response.status, 201, bound.raw);
  assert.equal(bound.json.data.document.doc_type, docType);
  assert.equal(Object.hasOwn(bound.json.data.document, 'storage_path'), false);
  assert.equal(bound.raw.includes('undal/private/vendor_kyc/'), false);
  return ticket.json.data.asset_id;
}

test('Response 16 W1 application, KYC vault, RSA payout and zone waitlist are owner-bound and server-checked', async () => {
  resetRateLimitBuckets();
  const db = await bootRealApiPostgres();
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const publicKeyBase64 = Buffer.from(await crypto.subtle.exportKey('spki', publicKey)).toString('base64');
  const privateKeyForAssertion = privateKey;
  partnerTestEnv = {
    SERVICE_NAME: 'undal-api',
    ENVIRONMENT: 'test',
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
    CLOUDINARY_CLOUD_NAME: 'undal-private-vault',
    CLOUDINARY_API_KEY: randomBytes(8).toString('hex'),
    CLOUDINARY_API_SECRET: randomBytes(32).toString('hex'),
    VENDOR_PAYOUT_PUBLIC_KEY_SPKI_B64: publicKeyBase64,
    __dbAdapter: createPgliteAdapter(db),
    __fetchImpl: async () => { throw new Error('Unexpected external network request'); },
  };
  try {
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('${PARTNER_ID}', 'home-owner@undal.test', '{"full_name":"Home Kitchen Owner"}'::jsonb),
        ('${RESTAURANT_ID}', 'restaurant-owner@undal.test', '{"full_name":"Restaurant Owner"}'::jsonb),
        ('${CLOUD_ID}', 'cloud-owner@undal.test', '{"full_name":"Cloud Kitchen Owner"}'::jsonb);
    `);
    const partnerToken = await mintTestJwt(PARTNER_ID);
    const restaurantToken = await mintTestJwt(RESTAURANT_ID);
    const cloudToken = await mintTestJwt(CLOUD_ID);

    const home = await createApplication(partnerToken, 'HOME_KITCHEN', 'home-owner');
    assert.equal(home.accepts_pickup, false, 'home kitchens start with pickup disabled');
    assert.equal(home.address_text_private, 'Private kitchen address, owner only');
    const cloud = await createApplication(cloudToken, 'CLOUD_KITCHEN', 'cloud-owner');
    assert.equal(cloud.accepts_pickup, false, 'cloud kitchens start with pickup disabled');
    const restaurant = await createApplication(restaurantToken, 'RESTAURANT', 'restaurant-owner', {
      pickup_point_label: 'Front counter',
    });
    assert.equal(restaurant.accepts_pickup, true, 'restaurant pickup starts opted in per D-24');

    const privateGet = await requestJson('/v1/partner/application', partnerToken);
    assert.equal(privateGet.response.status, 200);
    assert.equal(privateGet.json.data.application.address_text_private, 'Private kitchen address, owner only');
    assert.equal(privateGet.response.headers.get('cache-control'), 'private, no-store');
    const terms = await requestJson('/v1/partner/application/terms', partnerToken);
    assert.equal(terms.json.data.version, 'partner-commission-v1');
    assert.equal(
      terms.json.data.sha256,
      createHash('sha256').update(`${terms.json.data.version}\n${terms.json.data.text_en}\n${terms.json.data.text_bn}`, 'utf8').digest('hex'),
    );
    assert.equal(terms.json.data.sha256, 'c4fd6022b88d7f8e37250f9f5b9dc87f53586e795b54c1c8291b3ec2100f4751');

    const kitchenUpdate = await requestJson('/v1/partner/application', partnerToken, {
      method: 'PATCH',
      idempotencyKey: 'home-kitchen-fields-01',
      body: {
        onboarding_menu: [{ name: 'Shatkora Beef', price_poisha: 38000 }],
        on_demand_declared: true,
        typical_prep_minutes: 35,
        hygiene_checklist: { clean_water: true, safe_storage: true, clean_surfaces: true, food_grade_packaging: true },
        packaging_standard_accepted: true,
      },
    });
    assert.equal(kitchenUpdate.response.status, 200, kitchenUpdate.raw);
    assert.equal(kitchenUpdate.json.data.application.partner_prep_minutes_estimate, 35);
    assert.equal(kitchenUpdate.json.data.application.onboarding_menu[0].price_poisha, 38000);
    const fractionalMenuPrice = await requestJson('/v1/partner/application', partnerToken, {
      method: 'PATCH', idempotencyKey: 'home-menu-fractional-price',
      body: { onboarding_menu: [{ name: 'Invalid money', price_poisha: 38000.5 }] },
    });
    assert.equal(fractionalMenuPrice.response.status, 422);
    assert.equal(fractionalMenuPrice.json.error.code, 'VALIDATION_FAILED');

    const incomplete = await requestJson('/v1/partner/application/submit', partnerToken, {
      method: 'POST', idempotencyKey: 'home-submit-before-kyc', body: {},
    });
    assert.equal(incomplete.response.status, 403, incomplete.raw);
    assert.equal(incomplete.json.error.code, 'KYC_INCOMPLETE');
    assert.ok(incomplete.json.error.details.missing.includes('nid_or_passport_front_and_back'));
    assert.ok(incomplete.json.error.details.missing.includes('hours_4h_x_5days'));

    const today = new Date().toISOString().slice(0, 10);
    const staleDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await uploadAndBind(partnerToken, 'home-owner', 'utility_bill', { issued_on: staleDate });
    const staleBillSubmission = await requestJson('/v1/partner/application/submit', partnerToken, {
      method: 'POST', idempotencyKey: 'home-submit-stale-utility-bill', body: {},
    });
    assert.equal(staleBillSubmission.response.status, 403);
    assert.ok(staleBillSubmission.json.error.details.missing.includes('utility_bill_issued_within_90_days'));
    for (const docType of ['nid_front', 'nid_back', 'utility_bill', 'kitchen_hygiene_photo', 'bank_proof']) {
      await uploadAndBind(partnerToken, 'home-owner', docType, docType === 'utility_bill' ? { issued_on: today } : {});
    }
    const storedDocs = await db.query(`SELECT doc_type, media_asset_id, issued_on, storage_path FROM public.vendor_documents WHERE vendor_id = $1 ORDER BY created_at DESC`, [home.id]);
    assert.equal(storedDocs.rows.length, 6);
    assert.ok(storedDocs.rows.every((row) => row.storage_path.startsWith(`undal/private/vendor_kyc/${PARTNER_ID}/`)));
    assert.equal(storedDocs.rows.find((row) => row.doc_type === 'utility_bill').issued_on.toISOString().slice(0, 10), today);
    const applicationAfterDocs = await requestJson('/v1/partner/application', partnerToken);
    assert.equal(applicationAfterDocs.json.data.application.documents.length, 6, JSON.stringify(applicationAfterDocs.json.data.application.documents));

    const hours = Array.from({ length: 7 }, (_, weekday) => weekday < 5
      ? { weekday, is_closed: false, open1: '09:00', close1: '13:00', open2: null, close2: null }
      : { weekday, is_closed: true, open1: null, close1: null, open2: null, close2: null });
    const savedHours = await requestJson('/v1/partner/application/hours', partnerToken, {
      method: 'POST', idempotencyKey: 'home-hours-seven-days', body: { hours },
    });
    assert.equal(savedHours.response.status, 200, savedHours.raw);
    assert.equal(savedHours.json.data.application.hours.length, 7);

    const payout = await requestJson('/v1/partner/application/payout', partnerToken, {
      method: 'POST',
      idempotencyKey: 'home-payout-encrypted',
      body: { method: 'bkash', holder_name: 'Home Kitchen Owner', account_number: '01716000001' },
    });
    assert.equal(payout.response.status, 200, payout.raw);
    assert.equal(payout.json.data.application.payout.masked, '017****0001');
    assert.equal(payout.raw.includes('01716000001'), false);
    const encryptedRow = (await db.query('SELECT account_ref_enc FROM public.vendor_payout_accounts WHERE vendor_id = $1', [home.id])).rows[0];
    assert.notEqual(Buffer.from(encryptedRow.account_ref_enc).toString('utf8'), '01716000001');
    const decrypted = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKeyForAssertion, encryptedRow.account_ref_enc);
    assert.equal(new TextDecoder().decode(decrypted), '01716000001');

    const acceptedTerms = await requestJson('/v1/partner/application', partnerToken, {
      method: 'PATCH',
      idempotencyKey: 'home-terms-acceptance',
      body: { accepted_terms: true, agreement_version: terms.json.data.version },
    });
    assert.equal(acceptedTerms.response.status, 200, acceptedTerms.raw);
    assert.equal(acceptedTerms.json.data.application.partner_agreement_hash, terms.json.data.sha256);

    const submitted = await requestJson('/v1/partner/application/submit', partnerToken, {
      method: 'POST', idempotencyKey: 'home-application-submit', body: {},
    });
    assert.equal(submitted.response.status, 200, submitted.raw);
    assert.equal(submitted.json.data.application.kyc_status, 'submitted');
    assert.equal(submitted.json.data.application.is_active, false);
    assert.equal((await db.query('SELECT role FROM public.profiles WHERE id = $1', [PARTNER_ID])).rows[0].role, 'customer', 'applicants cannot self-elevate their account role before W3 approval.');

    const ticket = await requestJson('/v1/images/private-upload-url', partnerToken, {
      method: 'POST', idempotencyKey: 'home-private-view-ticket',
      body: { category: 'vendor_kyc', bytes: 2048, format: 'jpg' },
    });
    const crossOwnerBind = await requestJson('/v1/partner/application/documents', restaurantToken, {
      method: 'POST', idempotencyKey: 'cross-owner-document-bind',
      body: { asset_id: ticket.json.data.asset_id, doc_type: 'passport_front' },
    });
    assert.equal(crossOwnerBind.response.status, 403);
    const privateView = await requestJson('/v1/images/private-view-url', partnerToken, {
      method: 'POST', body: { asset_id: ticket.json.data.asset_id },
    });
    assert.equal(privateView.response.status, 200, privateView.raw);
    assert.match(privateView.json.data.signed_url, /^https:\/\/res\.cloudinary\.com\/undal-private-vault\/image\/authenticated\/s--/);
    assert.equal(privateView.response.headers.get('cache-control'), 'private, no-store');
    const viewAudit = (await db.query(`SELECT action, diff FROM public.audit_logs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [ticket.json.data.asset_id])).rows[0];
    assert.equal(viewAudit.action, 'media.private_view');

    await uploadAndBind(restaurantToken, 'restaurant-owner', 'passport_front');
    await uploadAndBind(restaurantToken, 'restaurant-owner', 'passport_back');
    await uploadAndBind(restaurantToken, 'restaurant-owner', 'trade_license', {
      expires_on: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    for (const docType of ['tin', 'bin', 'menu_doc', 'bank_proof']) {
      await uploadAndBind(restaurantToken, 'restaurant-owner', docType);
    }
    const restaurantHours = await requestJson('/v1/partner/application/hours', restaurantToken, {
      method: 'POST', idempotencyKey: 'restaurant-hours-seven-days', body: { hours },
    });
    assert.equal(restaurantHours.response.status, 200, restaurantHours.raw);
    const restaurantPayout = await requestJson('/v1/partner/application/payout', restaurantToken, {
      method: 'POST', idempotencyKey: 'restaurant-payout-encrypted',
      body: { method: 'bkash', holder_name: 'Restaurant Owner', account_number: '01819000001' },
    });
    assert.equal(restaurantPayout.response.status, 200, restaurantPayout.raw);
    const restaurantTerms = await requestJson('/v1/partner/application', restaurantToken, {
      method: 'PATCH', idempotencyKey: 'restaurant-terms-acceptance',
      body: { accepted_terms: true, agreement_version: terms.json.data.version },
    });
    assert.equal(restaurantTerms.response.status, 200, restaurantTerms.raw);
    const restaurantSubmitted = await requestJson('/v1/partner/application/submit', restaurantToken, {
      method: 'POST', idempotencyKey: 'restaurant-application-submit', body: {},
    });
    assert.equal(restaurantSubmitted.response.status, 200, restaurantSubmitted.raw);
    assert.equal(restaurantSubmitted.json.data.application.kyc_status, 'submitted');

    await db.query("UPDATE public.vendor_documents SET review_status = 'approved' WHERE vendor_id = $1 AND doc_type = 'passport_front'", [restaurant.id]);
    await db.query("UPDATE public.vendors SET kyc_status = 'needs_fix' WHERE id = $1", [restaurant.id]);
    const replacementTicket = await requestJson('/v1/images/private-upload-url', restaurantToken, {
      method: 'POST', idempotencyKey: 'restaurant-approved-replacement-ticket',
      body: { category: 'vendor_kyc', bytes: 2048, format: 'jpg' },
    });
    const lockedReplacement = await requestJson('/v1/partner/application/documents', restaurantToken, {
      method: 'POST', idempotencyKey: 'restaurant-approved-document-locked',
      body: { asset_id: replacementTicket.json.data.asset_id, doc_type: 'passport_front' },
    });
    assert.equal(lockedReplacement.json.error.code, 'ORDER_STATE_ILLEGAL');
    assert.equal(lockedReplacement.json.error.details.reason, 'APPROVED_KYC_DOCUMENT_LOCKED');

    const waitlistRequest = {
      vendor_type: 'HOME_KITCHEN', lat: 24.5186, lng: 92.0336, public_area_label: 'Kulaura Station Road',
    };
    const waitlisted = await requestJson('/v1/partner/waitlist', partnerToken, {
      method: 'POST', idempotencyKey: 'waitlist-kulaura-0001', body: waitlistRequest,
    });
    assert.equal(waitlisted.response.status, 201, waitlisted.raw);
    assert.equal(waitlisted.json.data.waitlisted, true);
    const repeatedWaitlist = await requestJson('/v1/partner/waitlist', partnerToken, {
      method: 'POST', idempotencyKey: 'waitlist-kulaura-0001', body: waitlistRequest,
    });
    assert.equal(repeatedWaitlist.response.status, 201, repeatedWaitlist.raw);
    assert.equal(repeatedWaitlist.json.data.request_id, waitlisted.json.data.request_id);
    const waitlistRow = (await db.query('SELECT vendor_type, public_area_label FROM public.partner_zone_waitlist WHERE profile_id = $1', [PARTNER_ID])).rows[0];
    assert.equal(waitlistRow.public_area_label, 'Kulaura Station Road');
    assert.equal(JSON.stringify(waitlistRow).includes('Private kitchen address'), false);
    const activeZoneWaitlist = await requestJson('/v1/partner/waitlist', partnerToken, {
      method: 'POST', idempotencyKey: 'waitlist-active-zone-01',
      body: { ...waitlistRequest, lat: 24.8949, lng: 91.8687 },
    });
    assert.equal(activeZoneWaitlist.response.status, 200);
    assert.equal(activeZoneWaitlist.json.data.waitlisted, false);
  } finally {
    partnerTestEnv = null;
    await db.close();
  }
});

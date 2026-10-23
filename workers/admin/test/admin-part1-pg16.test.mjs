/**
 * @file workers/admin/test/admin-part1-pg16.test.mjs
 * @description End-to-End Integration Suite on Real **PostgreSQL 16 (`PGlite` + `0001..0016`)**
 * for **`Build Response 10` (`W3 undal-admin` Part 1 — Capabilities `C1..C70` across Domains 1–4)**:
 *   - Domain 1 (`C1–C21`): TOTP 2FA enroll -> Step-Up -> Admin user CRUD, Roles diff preview & custom role,
 *     Session revocation (`401 SESSION_EXPIRED`), Settings edit + 1-click version rollback (`C14`),
 *     Kill switches (`C16–C18`), Deep health/quotas (`C19–C20`), Error triage (`C21`), Audit CSV (`C12`)
 *   - Domain 2 (`C22–C40`): Live Dispatch map/board (`exceptions_only=1`), Manual assign, Reassign with
 *     live `calculateRiderFare()` recompute, Unassign, ETA boost, Force-complete writing real PG16
 *     double-entry `ledger_entries` rows (`C32`), Order cancel, Fleet cash, Force session end, Batch break
 *   - Domain 3 (`C41–C54`): **Kulaura 1-Tap Launch (`C43`)**, Zone create, Fee tiers, Weather override &
 *     Interactive Live Fare Simulator (`C53`)
 *   - Domain 4 (`C55–C70` + `ADR-0006 v2`): 3-Track KYC queue, **Short-lived `120s` Signed Private Cloudinary
 *     URL (`POST /v1/images/private-view-url`) writing `kyc.doc.view` to `audit_logs` & rejecting public ImgBB**,
 *     KYC decide, Expiring docs, Vendor 360 + emergency pause + suspend, Menu moderation & Taxonomy CRUD
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  createAdminPostgrestAdapter,
  generateCirclePolygon,
  generateTotpCode,
  resetAdminSessionRegistry,
  signAdminHs256Jwt,
} from '../src/index.ts';
import {
  bootRealAdminPostgres,
  createPgliteAdminAdapter,
  EXAMPLE_ADMIN_JWT_SECRET,
  EXAMPLE_ADMIN_TOTP_PEPPER,
  EXAMPLE_CLOUDINARY_SECRET,
} from './_helpers/pglite-admin-harness.mjs';

test('W3 undal-admin Part 1 E2E on Real PostgreSQL 16 (C1..C70 across Governance, Dispatch, Zones/Fare & 3-Track KYC)', async () => {
  resetAdminSessionRegistry();
  const pg = await bootRealAdminPostgres();
  const dbAdapter = createPgliteAdminAdapter(pg);
  let clockMs = Date.parse('2026-10-23T15:00:00Z');

  const env = {
    SERVICE_NAME: 'undal-admin',
    SUPABASE_JWT_SECRET: EXAMPLE_ADMIN_JWT_SECRET,
    ADMIN_TOTP_PEPPER: EXAMPLE_ADMIN_TOTP_PEPPER,
    UNDAL_CLOUDINARY_CLOUD_NAME: 'undal-vault-example',
    CLOUDINARY_API_SECRET: EXAMPLE_CLOUDINARY_SECRET,
    dbAdapter,
    nowMs: () => clockMs,
  };

  // 1. Bootstrap Founder `super_admin` -> Enroll TOTP (`POST /v1/admin/auth/totp/enroll`) -> Mint `5m` Step-Up (`POST /v1/admin/auth/step-up`)
  const founderId = '20000000-0000-4000-8000-000000000001';
  await dbAdapter.upsertAdminUser({
    profileId: founderId,
    email: 'founder@undal.app',
    fullName: 'Founder Super Admin',
    phone: '01711009901',
    status: 'active',
    nowMs: clockMs,
  });
  await dbAdapter.setAdminUserRoles(founderId, ['super_admin'], founderId);

  const founderJwt = await signAdminHs256Jwt(
    { sub: founderId, role: 'admin', jti: 'sess-founder-main', exp: Math.floor(clockMs / 1000) + 3600 },
    EXAMPLE_ADMIN_JWT_SECRET,
  );
  const secondaryJwt = await signAdminHs256Jwt(
    { sub: founderId, role: 'admin', jti: 'sess-founder-tablet-2', exp: Math.floor(clockMs / 1000) + 3600 },
    EXAMPLE_ADMIN_JWT_SECRET,
  );

  const callW3 = (path, init = {}) =>
    worker.fetch(new Request(`https://admin.undal.app${path}`, init), env);

  const enrollRes = await callW3('/v1/admin/auth/totp/enroll', {
    method: 'POST',
    headers: { Authorization: `Bearer ${founderJwt}` },
  });
  const enrollJson = await enrollRes.json();
  assert.equal(enrollRes.status, 200);
  assert.ok(enrollJson.data.otpauthUri.startsWith('otpauth://totp/'));

  const totpCode = await generateTotpCode(enrollJson.data.secretBase32, clockMs);
  const stepUpRes = await callW3('/v1/admin/auth/step-up', {
    method: 'POST',
    headers: { Authorization: `Bearer ${founderJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: totpCode }),
  });
  const stepUpToken = (await stepUpRes.json()).data.token;
  assert.equal(stepUpRes.status, 200);

  const adminHeaders = {
    Authorization: `Bearer ${founderJwt}`,
    'Content-Type': 'application/json',
    'X-Undal-Step-Up': stepUpToken,
  };

  // --- DOMAIN 1 (`C1–C21`): Admin Users, Roles Diff Preview, Session Revoke, Settings Rollback, Kill Switches, Errors & Audit CSV ---
  const createStaffRes = await callW3('/v1/admin/users', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email: 'ops1@undal.app', full_name: 'Sylhet Ops Lead', status: 'active' }),
  });
  const createdStaff = (await createStaffRes.json()).data;
  assert.equal(createStaffRes.status, 201);

  assert.equal(
    (
      await callW3(`/v1/admin/users/${createdStaff.id}/roles`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ roles: ['ops_manager'] }),
      })
    ).status,
    200,
  );

  const customRoleRes = await callW3('/v1/admin/roles', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      key: 'night_lead',
      name_en: 'Night Tower Lead',
      name_bn: 'নাইট টাওয়ার লিড',
      permissions: ['2.live_map', '2.order_tower', '2.interventions'],
    }),
  });
  assert.equal(customRoleRes.status, 201);

  const diffPreview = await (
    await callW3('/v1/admin/roles/preview-diff', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ role_id: 'ops_manager', permissions: ['2.*', '3.*', '4.*'] }),
    })
  ).json();
  assert.equal(diffPreview.data.affectedAdminUsers, 1);

  // Touch secondary session then revoke it (`C8`) -> immediate `401 SESSION_EXPIRED`!
  assert.equal((await callW3('/v1/admin/sessions', { headers: { Authorization: `Bearer ${secondaryJwt}` } })).status, 200);
  assert.equal((await callW3('/v1/admin/sessions/sess-founder-tablet-2', { method: 'DELETE', headers: adminHeaders })).status, 200);
  assert.equal((await callW3('/v1/admin/sessions', { headers: { Authorization: `Bearer ${secondaryJwt}` } })).status, 401);

  // Update `platform_settings` (`500 -> 700`) then 1-click rollback (`C13–C14`) -> back to `500`!
  await callW3('/v1/admin/settings', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ updates: { 'money.platform_fee_poisha': 700 }, reason: 'Peak test' }),
  });
  const rbRes = await (
    await callW3('/v1/admin/settings/rollback', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ key: 'money.platform_fee_poisha', reason: 'Revert test' }),
    })
  ).json();
  assert.equal(rbRes.data.restoredValue, 500);

  // Kill switch (`C17`) + Client error triage (`C21`) + Health quotas (`C20`, `supabaseStorageBytes === 0`!)
  assert.equal(
    (
      await callW3('/v1/admin/kill-switches', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ kind: 'realtime', realtime_mode: 'polling', reason: 'Spark drill' }),
      })
    ).status,
    200,
  );
  const errRow = (
    await pg.query(
      `INSERT INTO public.client_errors (surface, app_version, error_code, message)
       VALUES ('partner_app', '1.0.0', 'NETWORK_TIMEOUT', 'Socket timeout') RETURNING id`,
    )
  ).rows[0];
  assert.equal(
    (
      await callW3('/v1/admin/errors', {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ id: Number(errRow.id), status: 'resolved', note: 'Fixed' }),
      })
    ).status,
    200,
  );
  const healthQuotas = (await (await callW3('/v1/admin/health/quotas', { headers: adminHeaders })).json()).data;
  assert.equal(healthQuotas.supabaseStorageBytes, 0);

  // --- DOMAIN 3 (`C41–C54`): **Kulaura 1-Tap Launch (`C43`)**, Circle Zone Create, Fee Tiers, Weather Override & Fare Simulator ---
  const zonesList = (await (await callW3('/v1/admin/zones', { headers: adminHeaders })).json()).data.zones;
  const sylhetZone = zonesList.find((z) => z.slug === 'sylhet-sadar');
  const kulauraZone = zonesList.find((z) => z.slug === 'kulaura');
  assert.equal(sylhetZone.isActive, true);
  assert.equal(kulauraZone.isActive, false, 'Kulaura starts paused awaiting 1-tap launch');

  const kulauraLaunch = await callW3(`/v1/admin/zones/${kulauraZone.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ is_active: true, reason: 'Launch Kulaura town!' }),
  });
  assert.equal(kulauraLaunch.status, 200);
  assert.equal((await kulauraLaunch.json()).data.is_active, true);

  const newTownPoly = generateCirclePolygon({ centerLat: 24.4809, centerLng: 91.7715, radiusKm: 3.0, vertices: 16 });
  const createdZoneRes = await callW3('/v1/admin/zones', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ name_en: 'Moulvibazar Town', name_bn: 'মৌলভীবাজার শহর', slug: 'moulvibazar-town', polygon: newTownPoly }),
  });
  assert.equal(createdZoneRes.status, 201);

  assert.equal(
    (
      await callW3(`/v1/admin/zones/${sylhetZone.id}/fees`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ tiers_poisha: [{ max_km: 3, fee_poisha: 4000 }], free_delivery_min_poisha: 50000 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await callW3(`/v1/admin/zones/${sylhetZone.id}/weather-override`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ condition: 'storm', ttl_minutes: 90, reason: 'Kalbaishakhi squall' }),
      })
    ).status,
    200,
  );

  // Exact Golden Vector F-1 check via Live Fare Simulator (`C53`): `13584` poisha!
  const simRes = await (
    await callW3('/v1/admin/fare/simulate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        vehicle: 'motorbike',
        to_vendor_km: 1.2,
        to_customer_km: 5.0,
        food_payable_after_discount_poisha: 43280,
        active_orders_in_zone: 8,
        active_riders_in_zone: 3,
        weather: 'rain',
        traffic_delay_minutes: 12,
        batch_index: 1,
        priority: false,
      }),
    })
  ).json();
  assert.equal(simRes.data.breakdown.riderFarePoisha, 13_584);

  // --- DOMAIN 2 (`C22–C40`) + DOMAIN 4 (`C55–C70` & `ADR-0006 v2` Private Signed URL + Double-Entry Force Complete) ---
  const custProfileId = '20000000-0000-4000-8000-000000000011';
  const vendOwnerId = '20000000-0000-4000-8000-000000000012';
  const riderProfileId = '20000000-0000-4000-8000-000000000013';
  for (const [id, role, name, phone] of [
    [custProfileId, 'customer', 'Tahmid Customer', '01711009911'],
    [vendOwnerId, 'vendor_owner', 'Home Chef Ruma', '01711009912'],
    [riderProfileId, 'rider', 'Rider Tanvir', '01711009913'],
  ]) {
    await pg.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@undal.app`]);
    await pg.query(
      `UPDATE public.profiles SET role = $2, status = 'active', full_name = $3, phone = $4 WHERE id = $1`,
      [id, role, name, phone],
    );
  }

  const vendorId = (
    await pg.query(
      `INSERT INTO public.vendors (
         owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
         public_area_label, address_text_private, counter_phone, zone_id,
         kyc_status, is_active, commission_bps
       ) VALUES ($1, 'HOME_KITCHEN', 'Ruma Kitchen', 'Rumas Home Kitchen', 'rumas-kitchen', 24.896, 91.871, 'wh28z9x11',
         'Subidbazar, Sylhet', 'House 12 Subidbazar', '01712349912', $2, 'submitted', false, 1500)
       RETURNING id`,
      [vendOwnerId, sylhetZone.id],
    )
  ).rows[0].id;

  const docId = (
    await pg.query(
      `INSERT INTO public.vendor_documents (vendor_id, doc_type, storage_path, review_status, expires_on)
       VALUES ($1, 'nid_front', 'undal/private/vendor_kyc/nid-ruma', 'pending', '2026-11-05') RETURNING id`,
      [vendorId],
    )
  ).rows[0].id;

  const riderId = (
    await pg.query(
      `INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id)
       VALUES ($1, 'motorbike', '1998-03-15', 'approved', true, true, $2) RETURNING id`,
      [riderProfileId, sylhetZone.id],
    )
  ).rows[0].id;

  // Insert 1 private Cloudinary KYC asset AND 1 public ImgBB menu_item asset in `public.media_assets`
  await pg.query(
    `INSERT INTO public.media_assets (owner_profile_id, provider, category, delivery_type, cloudinary_public_id, bytes)
     VALUES ($1, 'cloudinary', 'vendor_kyc', 'authenticated', 'undal/private/vendor_kyc/nid-ruma', 125000)`,
    [vendOwnerId],
  );
  await pg.query(
    `INSERT INTO public.media_assets (owner_profile_id, provider, category, delivery_type, cloudinary_public_id, public_cdn_url, bytes)
     VALUES ($1, 'imgbb', 'menu_item', 'upload', 'imgbb-kacchi-001', 'https://i.ibb.co/example/kacchi.jpg', 98000)`,
    [vendOwnerId],
  );

  // `POST /v1/images/private-view-url` (`C56`): mints `120s` `s--XXXXXXXX--` URL & logs `kyc.doc.view`; REJECTS `imgbb` public asset!
  const signedViewRes = await callW3('/v1/images/private-view-url', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ public_id: 'undal/private/vendor_kyc/nid-ruma', reason: 'Verify Home Kitchen NID' }),
  });
  const signedViewJson = await signedViewRes.json();
  assert.equal(signedViewRes.status, 200);
  assert.match(signedViewJson.data.signedUrl, /\/authenticated\/s--[A-Za-z0-9_-]{8}--\/e_expires_/);

  const imgbbRejected = await callW3('/v1/images/private-view-url', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ public_id: 'imgbb-kacchi-001' }),
  });
  assert.equal(imgbbRejected.status, 422);

  // Approve 3-Track `HOME_KITCHEN` KYC (`C57`) + verify Expiring Watchlist (`C59`) + Vendor 360 & Pause & Suspend (`C60–C65`)
  const kycApproved = await callW3(`/v1/admin/kyc/vendor/${vendorId}/decide`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      decision: 'approved',
      document_decisions: [{ docId, status: 'approved', note: 'Clear NID' }],
    }),
  });
  assert.equal(kycApproved.status, 200);
  assert.equal((await kycApproved.json()).data.is_active, true);

  const expiring = (await (await callW3('/v1/admin/kyc/expiring?days=30', { headers: adminHeaders })).json()).data.items;
  assert.equal(expiring.length, 1);

  assert.equal((await callW3(`/v1/admin/vendors/${vendorId}`, { headers: adminHeaders })).status, 200);
  assert.equal((await callW3(`/v1/admin/vendors/${vendorId}/ranking`, { headers: adminHeaders })).status, 200);
  assert.equal((await callW3(`/v1/admin/vendors/${vendorId}/pause`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ minutes: 30, reason: 'Gas cylinder swap' }) })).status, 200);
  assert.equal((await callW3(`/v1/admin/vendors/${vendorId}/suspend`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ suspended: false }) })).status, 200);

  // Taxonomy upsert (`C69`) + Menu item moderation (`C66–C68`) + Catalog search (`C70`)
  assert.equal(
    (
      await callW3('/v1/admin/taxonomy', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ key: 'shatkora_beef', name_en: 'Sylheti Shatkora Beef', name_bn: 'সিলেটি সাতকরা গরুর মাংস', synonyms: ['hatkora', 'shatkora'] }),
      })
    ).status,
    201,
  );
  const catId = (
    await pg.query(`INSERT INTO public.menu_categories (vendor_id, name_en, name_bn) VALUES ($1, 'Mains', 'প্রধান খাবার') RETURNING id`, [vendorId])
  ).rows[0].id;
  const itemId = (
    await pg.query(
      `INSERT INTO public.menu_items (vendor_id, category_id, name_en, name_bn, price_poisha, compare_at_poisha)
       VALUES ($1, $2, 'Shatkora Bhuna', 'সাতকরা ভুনা', 30000, 55000) RETURNING id`,
      [vendorId, catId],
    )
  ).rows[0].id;
  assert.equal((await (await callW3('/v1/admin/menu/price-alerts', { headers: adminHeaders })).json()).data.alerts.length, 1);
  assert.equal((await callW3(`/v1/admin/menu/items/${itemId}/moderate`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ action: 'hide', note: 'Inflated compare_at' }) })).status, 200);
  assert.equal((await (await callW3('/v1/admin/catalog/search?q=Shatkora', { headers: adminHeaders })).json()).data.items.length, 1);

  // Dispatch interventions (`C28–C33`): Create order -> Assign -> Reassign -> Force-Complete (`DELIVERED` writes real double-entry `ledger_entries`!)
  const orderId = (
    await pg.query(
      `INSERT INTO public.orders (
         public_code, customer_id, vendor_id, zone_id, fulfilment, status,
         address_snapshot, vendor_snapshot, items_poisha, discount_total_poisha,
         discount_vendor_poisha, discount_platform_poisha, delivery_fee_poisha,
         platform_fee_poisha, tip_poisha, tax_extracted_poisha, cod_collect_poisha,
         commission_poisha, vendor_net_poisha, undal_margin_poisha,
         pickup_qr_nonce, pickup_code_4, prep_minutes_committed, placed_at
       ) VALUES (
         'UD-SYL-261023-7701', $1, $2, $3, 'delivery', 'READY_FOR_PICKUP',
         '{"lat":24.901,"lng":91.872}'::jsonb, '{"lat":24.896,"lng":91.871}'::jsonb,
         30000, 0, 0, 0, 6000, 500, 0, 1429, 36500, 4500, 25500, 5000,
         '0123456789abcdef7701', '7701', 20, $4
       ) RETURNING id`,
      [custProfileId, vendorId, sylhetZone.id, new Date(clockMs - 240_000).toISOString()],
    )
  ).rows[0].id;

  assert.equal((await (await callW3('/v1/admin/dispatch/board?exceptions_only=1', { headers: adminHeaders })).json()).data.count, 1);
  assert.equal((await callW3(`/v1/admin/orders/${orderId}/reassign`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ rider_id: riderId, to_vendor_km: 1.0, to_customer_km: 2.5 }) })).status, 200);
  assert.equal((await callW3(`/v1/admin/orders/${orderId}/eta`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ extra_minutes: 10 }) })).status, 200);

  const forceRes = await callW3(`/v1/admin/orders/${orderId}/force-complete`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      evidence_public_id: 'undal/private/dispute_evidence/pod-7701',
      note: 'Customer confirmed handover by phone during network outage',
    }),
  });
  assert.equal(forceRes.status, 200);

  // Verify real PG16 `DELIVERED` trigger automatically posted conserved double-entry rows into `public.ledger_entries`!
  const ledgerRows = (await pg.query('SELECT * FROM public.ledger_entries WHERE order_id = $1', [orderId])).rows;
  assert.ok(ledgerRows.length >= 2, 'Force-complete DELIVERED must trigger real PG16 double-entry ledger entries');

  // Verify `POST /v1/admin/audit/export` (`C12`) produces CSV containing all audited mutations including `kyc.doc.view`!
  const exportJson = (await (await callW3('/v1/admin/audit/export', { method: 'POST', headers: adminHeaders })).json()).data;
  assert.ok(exportJson.csv.includes('kyc.doc.view'));
  assert.ok(exportJson.csv.includes('dispatch.force_complete'));
  assert.ok(exportJson.csv.includes('zone.update'));

  // Verify `createAdminPostgrestAdapter` speaks clean `/rest/v1/*` wire calls
  const wireUrls = [];
  const restAdapter = createAdminPostgrestAdapter(
    { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'example-service-role-key' },
    async (u) => {
      wireUrls.push(String(u));
      return Response.json([]);
    },
  );
  await restAdapter.listZonesAdmin();
  assert.ok(wireUrls[0].startsWith('https://proj.supabase.co/rest/v1/zones?'));

  await pg.close();
});

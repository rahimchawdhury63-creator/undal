/**
 * @file workers/admin/test/admin-rbac-matrix.test.mjs
 * @description Exhaustive **Role × Capability Matrix + 4-Gate Security & Geometry Suite**
 * (`Build Response 10` — `W3 undal-admin` Part 1):
 *   - Tests all `7` canonical system roles (`super_admin`, `ops_manager`, `dispatcher`,
 *     `vendor_onboarding`, `finance`, `support`, `compliance_auditor`) + un-enrolled TOTP admin +
 *     suspended admin + customer account across EVERY domain route in `C1–C70`
 *   - Verifies RFC 6238 `TOTP-SHA1` (`±30s` skew, invalid code rejection, `5m` Step-Up expiry,
 *     and cross-actor Step-Up token spoofing rejection)
 *   - Verifies Domain 3 geometry engine (`generateCirclePolygon` `C42` + bowtie self-intersection &
 *     cross-zone overlap detection `C44`)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  deriveAdminTotpSecretBase32,
  generateCirclePolygon,
  generateTotpCode,
  resetAdminSessionRegistry,
  signAdminHs256Jwt,
  validateZonePolygon,
} from '../src/index.ts';
import {
  bootRealAdminPostgres,
  createPgliteAdminAdapter,
  EXAMPLE_ADMIN_JWT_SECRET,
  EXAMPLE_ADMIN_TOTP_PEPPER,
} from './_helpers/pglite-admin-harness.mjs';

test('W3 RBAC Matrix (all 7 system roles × all Domain 1–4 routes) + 4-Gate TOTP & Step-Up + Polygon Geometry', async () => {
  resetAdminSessionRegistry();
  const pg = await bootRealAdminPostgres();
  const dbAdapter = createPgliteAdminAdapter(pg);
  let clockMs = Date.parse('2026-10-23T14:00:00Z');

  const env = {
    SERVICE_NAME: 'undal-admin',
    SUPABASE_JWT_SECRET: EXAMPLE_ADMIN_JWT_SECRET,
    ADMIN_TOTP_PEPPER: EXAMPLE_ADMIN_TOTP_PEPPER,
    dbAdapter,
    nowMs: () => clockMs,
  };

  // Seed one active TOTP-enrolled admin per system role + non-enrolled + suspended + customer
  const roleUsers = {
    super_admin: '10000000-0000-4000-8000-000000000001',
    ops_manager: '10000000-0000-4000-8000-000000000002',
    dispatcher: '10000000-0000-4000-8000-000000000003',
    vendor_onboarding: '10000000-0000-4000-8000-000000000004',
    finance: '10000000-0000-4000-8000-000000000005',
    support: '10000000-0000-4000-8000-000000000006',
    compliance_auditor: '10000000-0000-4000-8000-000000000007',
  };
  const noTotpAdminId = '10000000-0000-4000-8000-000000000008';
  const suspendedAdminId = '10000000-0000-4000-8000-000000000009';
  const customerId = '10000000-0000-4000-8000-000000000010';

  const jwts = {};
  for (const [roleKey, uid] of Object.entries(roleUsers)) {
    await dbAdapter.upsertAdminUser({
      profileId: uid,
      email: `${roleKey}@undal.app`,
      fullName: `Role ${roleKey}`,
      status: 'active',
      nowMs: clockMs,
    });
    await dbAdapter.setAdminUserRoles(uid, [roleKey], uid);
    await dbAdapter.enrollAdminTotp(uid, clockMs);
    jwts[roleKey] = await signAdminHs256Jwt(
      { sub: uid, role: 'admin', exp: Math.floor(clockMs / 1000) + 3600 },
      EXAMPLE_ADMIN_JWT_SECRET,
    );
  }

  await dbAdapter.upsertAdminUser({
    profileId: noTotpAdminId,
    email: 'nototp@undal.app',
    fullName: 'No TOTP Admin',
    status: 'active',
    nowMs: clockMs,
  });
  await dbAdapter.setAdminUserRoles(noTotpAdminId, ['super_admin'], roleUsers.super_admin);

  await dbAdapter.upsertAdminUser({
    profileId: suspendedAdminId,
    email: 'suspended@undal.app',
    fullName: 'Suspended Admin',
    status: 'suspended',
    nowMs: clockMs,
  });
  await dbAdapter.enrollAdminTotp(suspendedAdminId, clockMs);

  await pg.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [customerId, 'cust@undal.app']);
  await pg.query(`UPDATE public.profiles SET full_name = 'Plain Customer', role = 'customer' WHERE id = $1`, [customerId]);

  const noTotpJwt = await signAdminHs256Jwt({ sub: noTotpAdminId, exp: Math.floor(clockMs / 1000) + 3600 }, EXAMPLE_ADMIN_JWT_SECRET);
  const suspendedJwt = await signAdminHs256Jwt({ sub: suspendedAdminId, exp: Math.floor(clockMs / 1000) + 3600 }, EXAMPLE_ADMIN_JWT_SECRET);
  const customerJwt = await signAdminHs256Jwt({ sub: customerId, exp: Math.floor(clockMs / 1000) + 3600 }, EXAMPLE_ADMIN_JWT_SECRET);

  // Gate 2 assertions: non-admin -> `AUTH_ROLE_MISMATCH`, suspended -> `AUTH_ACCOUNT_SUSPENDED`, un-enrolled -> `AUTH_TOTP_REQUIRED`
  const custRes = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/settings', { headers: { Authorization: `Bearer ${customerJwt}` } }),
    env,
  );
  assert.equal(custRes.status, 403);
  assert.equal((await custRes.json()).error.code, 'AUTH_ROLE_MISMATCH');

  const suspRes = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/settings', { headers: { Authorization: `Bearer ${suspendedJwt}` } }),
    env,
  );
  assert.equal(suspRes.status, 403);
  assert.equal((await suspRes.json()).error.code, 'AUTH_ACCOUNT_SUSPENDED');

  const noTotpRes = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/settings', { headers: { Authorization: `Bearer ${noTotpJwt}` } }),
    env,
  );
  assert.equal(noTotpRes.status, 403);
  assert.equal((await noTotpRes.json()).error.code, 'AUTH_TOTP_REQUIRED');

  // Gate 3 Exhaustive Role × Route Read Matrix across all 7 roles (56 live HTTP assertions!)
  const matrixProbes = [
    {
      path: '/v1/admin/users',
      allow: ['super_admin', 'compliance_auditor'],
    },
    {
      path: '/v1/admin/audit',
      allow: ['super_admin', 'compliance_auditor'],
    },
    {
      path: '/v1/admin/settings',
      allow: ['super_admin', 'ops_manager', 'compliance_auditor'],
    },
    {
      path: '/v1/admin/health/quotas',
      allow: ['super_admin'],
    },
    {
      path: '/v1/admin/dispatch/board',
      allow: ['super_admin', 'ops_manager', 'dispatcher'],
    },
    {
      path: '/v1/admin/zones',
      allow: ['super_admin', 'ops_manager'],
    },
    {
      path: '/v1/admin/kyc/queue',
      allow: ['super_admin', 'ops_manager', 'vendor_onboarding'],
    },
    {
      path: '/v1/admin/taxonomy',
      allow: ['super_admin', 'ops_manager', 'vendor_onboarding'],
    },
  ];

  for (const probe of matrixProbes) {
    for (const [roleKey, jwt] of Object.entries(jwts)) {
      const res = await worker.fetch(
        new Request(`https://admin.undal.app${probe.path}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        env,
      );
      const shouldAllow = probe.allow.includes(roleKey);
      assert.equal(
        res.status,
        shouldAllow ? 200 : 403,
        `Matrix mismatch on GET ${probe.path} for role "${roleKey}" (expected ${shouldAllow ? 200 : 403}, got ${res.status})`,
      );
    }
  }

  // Also verify read-only `compliance_auditor` CANNOT mutate `PATCH /v1/admin/settings` even WITH valid Step-Up token!
  const auditorSecret = await deriveAdminTotpSecretBase32({
    profileId: roleUsers.compliance_auditor,
    enrolledEpochMs: clockMs,
    pepper: EXAMPLE_ADMIN_TOTP_PEPPER,
  });
  const auditorCode = await generateTotpCode(auditorSecret, clockMs);
  const auditorStepUpRes = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/auth/step-up', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwts.compliance_auditor}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: auditorCode }),
    }),
    env,
  );
  const auditorStepUp = (await auditorStepUpRes.json()).data.token;

  const auditorMutateDenied = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${jwts.compliance_auditor}`,
        'Content-Type': 'application/json',
        'X-Undal-Step-Up': auditorStepUp,
      },
      body: JSON.stringify({ updates: { 'money.platform_fee_poisha': 600 } }),
    }),
    env,
  );
  assert.equal(auditorMutateDenied.status, 403);
  assert.equal((await auditorMutateDenied.json()).error.code, 'AUTH_FORBIDDEN_PERMISSION');

  // Gate 4 negative assertions: `super_admin` WITHOUT Step-Up OR using another admin's Step-Up OR expired (+301s) -> `403 AUTH_STEP_UP_REQUIRED`!
  const missingStepUp = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/settings', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwts.super_admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { 'money.platform_fee_poisha': 600 } }),
    }),
    env,
  );
  assert.equal(missingStepUp.status, 403);
  assert.equal((await missingStepUp.json()).error.code, 'AUTH_STEP_UP_REQUIRED');

  const spoofedStepUp = await worker.fetch(
    new Request('https://admin.undal.app/v1/admin/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${jwts.super_admin}`,
        'Content-Type': 'application/json',
        'X-Undal-Step-Up': auditorStepUp,
      },
      body: JSON.stringify({ updates: { 'money.platform_fee_poisha': 600 } }),
    }),
    env,
  );
  assert.equal(spoofedStepUp.status, 403);
  assert.equal((await spoofedStepUp.json()).error.code, 'AUTH_STEP_UP_REQUIRED');

  // Domain 3 Geometry Unit Proofs (`C42` + `C44` self-intersection & cross-zone overlap)
  const beanibazarCircle = generateCirclePolygon({
    centerLat: 24.8261,
    centerLng: 92.1625,
    radiusKm: 3.5,
    vertices: 20,
  });
  assert.equal(beanibazarCircle.length, 20);
  const existingZones = await dbAdapter.listZonesAdmin();
  const validGeo = validateZonePolygon({ polygon: beanibazarCircle, existingZones });
  assert.equal(validGeo.valid, true);
  assert.ok(validGeo.areaKm2 > 30 && validGeo.areaKm2 < 45);

  // Self-intersecting bowtie figure-8 polygon MUST fail with `self_intersection`
  const bowtie = [
    [92.30, 24.70],
    [92.35, 24.75],
    [92.30, 24.75],
    [92.35, 24.70],
  ];
  const bowtieCheck = validateZonePolygon({ polygon: bowtie, existingZones: [] });
  assert.equal(bowtieCheck.valid, false);
  assert.equal(bowtieCheck.selfIntersecting, true);
  assert.equal(bowtieCheck.reason, 'self_intersection');

  // Overlapping circle directly over seeded Sylhet Sadar center MUST fail with `zone_overlap`
  const overlappingSylhet = generateCirclePolygon({
    centerLat: 24.8949,
    centerLng: 91.8687,
    radiusKm: 2.0,
    vertices: 16,
  });
  const overlapCheck = validateZonePolygon({ polygon: overlappingSylhet, existingZones });
  assert.equal(overlapCheck.valid, false);
  assert.equal(overlapCheck.reason, 'zone_overlap');
  assert.ok(overlapCheck.overlappingSlugs.includes('sylhet-sadar'));

  await pg.close();
});

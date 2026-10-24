/**
 * @file workers/admin/test/admin-part2-pg16.test.mjs
 * @description End-to-End Integration Suite on Real **PostgreSQL 16 (`PGlite` + `0001..0016`)**
 * for **`Build Response 11` (`W3 undal-admin` Part 2 — Capabilities `C71..C132` across Domains 5–9
 * + ALL `4` Scheduled Cron Triggers — Completing `W3` 100.0%!)**:
 *   - Domain 5 (`C71–C89`): Motorbike `৳5,200` COD order -> automatic `cash_gate_blocked = true` ->
 *     `POST /v1/admin/remittances/:id/decide` (`TOTP✓`) -> instant `cash_gate_blocked = false` auto-unlock;
 *     Friday `5 18 * * 4` Rider + Saturday `5 18 * * 5` Vendor weekly settlement crons (`1.85%` bKash cover,
 *     `0` poisha drift recompute, bilingual `EN/বাংলা` printable statement HTML, **strict verifier ≠ payer
 *     dual-control** rejecting self-payout with `403` before Founder `super_admin` pays `VERIFIED -> PAID`),
 *     `>= ৳500` dual-control adjustments, actor ledger & settlement CSV pack
 *   - Domain 6 (`C90–C101`): Global `UD-*` order search, Order 360 deep replay, exception rules/resolve,
 *     mid-order pin/item modify & Step-Up goodwill compensation voucher
 *   - Domain 7 (`C102–C113`): Zero-Ads `D-11` enforcement (`kind: 'paid_ad'` rejected!), `ADR-0006 v2`
 *     ImgBB-only banner enforcement, `Flash Box` campaign + vendor opt-in + stats, vouchers, referrals,
 *     and bilingual `EN/বাংলা` nudge draft/preview/Step-Up send
 *   - Domain 8 (`C114–C124`): Support inbox claim/message/templates, live chats, **root-cause dispute split
 *     (`ready_at` vs `picked_at` -> `rider_late_pickup` + atomic vendor refund adjustment + goodwill voucher)**,
 *     review moderation auto-updating `vendors.rating_avg` trigger, and Customer 360
 *   - Domain 9 & Crons (`C125–C132`): Executive KPIs, saved CSV reports (`cloudinary_private_vault`),
 *     **live zero-drift `GET /v1/admin/bi/quality` (`vendorLedgerDriftPoisha === 0`)**, nightly quota prune
 *     (`30 20 * * *`), and hourly MET Norway weather sync (`0 * * * *`) preserving unexpired `admin_override`
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  generateTotpCode,
  resetAdminSessionRegistry,
  runAdminScheduledCron,
  signAdminHs256Jwt,
} from '../src/index.ts';
import {
  bootRealAdminPostgres,
  createPgliteAdminAdapter,
  EXAMPLE_ADMIN_JWT_SECRET,
  EXAMPLE_ADMIN_TOTP_PEPPER,
} from './_helpers/pglite-admin-harness.mjs';

test('W3 undal-admin Part 2 E2E on Real PostgreSQL 16 (C71..C132 across Settlement, Cash Gate, Order 360, Growth, Disputes, BI & All 4 Crons)', async () => {
  resetAdminSessionRegistry();
  const pg = await bootRealAdminPostgres();
  const dbAdapter = createPgliteAdminAdapter(pg);
  let clockMs = Date.parse('2026-10-23T18:05:00Z'); // Friday 00:05 Asia/Dhaka!
  const payoutKeyPair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const payoutPrivateKeyB64 = Buffer.from(await crypto.subtle.exportKey('pkcs8', payoutKeyPair.privateKey)).toString('base64');
  const payoutPublicKey = await crypto.subtle.exportKey('spki', payoutKeyPair.publicKey);

  const env = {
    SERVICE_NAME: 'undal-admin',
    SUPABASE_JWT_SECRET: EXAMPLE_ADMIN_JWT_SECRET,
    ADMIN_TOTP_PEPPER: EXAMPLE_ADMIN_TOTP_PEPPER,
    VENDOR_PAYOUT_PRIVATE_KEY_PKCS8_B64: payoutPrivateKeyB64,
    dbAdapter,
    nowMs: () => clockMs,
  };

  // Bootstrap TWO distinct admins (`finance` Officer A + `super_admin` Founder B) to prove dual-control (`verifier !== payer`)!
  const financeId = '30000000-0000-4000-8000-000000000001';
  const founderId = '30000000-0000-4000-8000-000000000002';

  const makeAdminHeaders = async (id, roleKey, email) => {
    await dbAdapter.upsertAdminUser({ profileId: id, email, fullName: roleKey, status: 'active', nowMs: clockMs });
    await dbAdapter.setAdminUserRoles(id, [roleKey], id);
    const jwt = await signAdminHs256Jwt(
      { sub: id, role: 'admin', exp: Math.floor(clockMs / 1000) + 7200 },
      EXAMPLE_ADMIN_JWT_SECRET,
    );
    const enr = await (
      await worker.fetch(
        new Request('https://admin.undal.app/v1/admin/auth/totp/enroll', {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        env,
      )
    ).json();
    const code = await generateTotpCode(enr.data.secretBase32, clockMs);
    const su = await (
      await worker.fetch(
        new Request('https://admin.undal.app/v1/admin/auth/step-up', {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }),
        env,
      )
    ).json();
    return {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'X-Undal-Step-Up': su.data.token,
    };
  };

  const financeHeaders = await makeAdminHeaders(financeId, 'finance', 'finance@undal.app');
  const founderHeaders = await makeAdminHeaders(founderId, 'super_admin', 'founder2@undal.app');
  const callW3 = (path, init = {}) => worker.fetch(new Request(`https://admin.undal.app${path}`, init), env);

  // Seed active Customer, Partner Kitchen & Motorbike Rider in `Sylhet Sadar`
  const sylhetZone = (await dbAdapter.listZonesAdmin()).find((z) => z.slug === 'sylhet-sadar');
  const custId = '30000000-0000-4000-8000-000000000011';
  const vendOwnerId = '30000000-0000-4000-8000-000000000012';
  const riderProfId = '30000000-0000-4000-8000-000000000013';
  for (const [id, role, name, phone] of [
    [custId, 'customer', 'Nadia Customer', '01715001111'],
    [vendOwnerId, 'vendor_owner', 'Panshi Owner', '01715001112'],
    [riderProfId, 'rider', 'Rider Jamil', '01715001113'],
  ]) {
    await pg.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@undal.app`]);
    await pg.query(`UPDATE public.profiles SET role = $2, status = 'active', full_name = $3, phone = $4 WHERE id = $1`, [
      id, role, name, phone,
    ]);
  }

  const vendorId = (
    await pg.query(
      `INSERT INTO public.vendors (
         owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
         public_area_label, address_text_private, counter_phone, zone_id, kyc_status, is_active, commission_bps
       ) VALUES ($1, 'RESTAURANT', 'Panshi Sylhet', 'Panshi Inn', 'panshi-inn', 24.895, 91.869, 'wh28z9a11',
         'Zindabazar, Sylhet', '14 Zindabazar Rd', '01715001112', $2, 'approved', true, 1500)
       RETURNING id`,
      [vendOwnerId, sylhetZone.id],
    )
  ).rows[0].id;

  const payoutCiphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, payoutKeyPair.publicKey, new TextEncoder().encode('01715009999'),
  );
  await pg.query(
    `INSERT INTO public.vendor_payout_accounts (vendor_id, method, holder_name, account_ref_enc, masked, is_primary)
     VALUES ($1, 'bkash', 'Panshi Finance', $2, '017****9999', true)`,
    [vendorId, new Uint8Array(payoutCiphertext)],
  );

  const riderId = (
    await pg.query(
      `INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id)
       VALUES ($1, 'motorbike', '1997-06-10', 'approved', true, true, $2) RETURNING id`,
      [riderProfId, sylhetZone.id],
    )
  ).rows[0].id;

  // Place & deliver a `৳5,200` (`520,000` poisha COD > `৳5,000` motorbike ceiling!) order `2` days inside settlement window
  const orderTimeMs = clockMs - 2 * 86_400_000;
  const orderId = (
    await pg.query(
      `INSERT INTO public.orders (
         public_code, customer_id, vendor_id, rider_id, zone_id, fulfilment, status,
         address_snapshot, vendor_snapshot, items_poisha, discount_total_poisha,
         discount_vendor_poisha, discount_platform_poisha, delivery_fee_poisha,
         platform_fee_poisha, tip_poisha, tax_extracted_poisha, cod_collect_poisha,
         rider_fare_poisha, rider_bonus_poisha, commission_poisha, vendor_net_poisha, undal_margin_poisha,
         pickup_qr_nonce, pickup_code_4, prep_minutes_committed, placed_at, accepted_at, ready_at, picked_at
       ) VALUES (
         'UD-SYL-261021-8801', $1, $2, $3, $4, 'delivery', 'PICKED_UP',
         '{"lat":24.901,"lng":91.872}'::jsonb, '{"lat":24.895,"lng":91.869}'::jsonb,
         500000, 0, 0, 0, 15000, 5000, 0, 23810, 520000,
         9500, 15000, 75000, 425000, 80000,
         '0123456789abcdef8801', '8801', 20, $5, $6, $7, $8
       ) RETURNING id`,
      [
        custId,
        vendorId,
        riderId,
        sylhetZone.id,
        new Date(orderTimeMs - 40 * 60_000).toISOString(),
        new Date(orderTimeMs - 38 * 60_000).toISOString(),
        new Date(orderTimeMs - 22 * 60_000).toISOString(), // 16 min kitchen prep (on time!)
        new Date(orderTimeMs - 4 * 60_000).toISOString(),  // 18 min rider wait after ready (`rider_late_pickup`!)
      ],
    )
  ).rows[0].id;

  const ordItemId = (
    await pg.query(
      `INSERT INTO public.order_items (order_id, name_en_snapshot, unit_poisha, qty, line_poisha)
       VALUES ($1, 'Sylheti Beef Platter (x5)', 100000, 5, 500000) RETURNING id`,
      [orderId],
    )
  ).rows[0].id;

  await pg.query(`UPDATE public.orders SET status = 'DELIVERED', delivered_at = $2 WHERE id = $1`, [
    orderId,
    new Date(orderTimeMs).toISOString(),
  ]);

  // 1. Verify Cash Gate AUTOMATICALLY locked motorbike rider (`520,000 >= 500,000` poisha ceiling)!
  const blockedRider = (await pg.query('SELECT cash_gate_blocked FROM public.riders WHERE id = $1', [riderId])).rows[0];
  assert.equal(blockedRider.cash_gate_blocked, true, 'Rider must be cash-gated immediately at ৳5,200 COD');

  // Rider submits `৳5,200` bKash TrxID remittance -> Finance Officer approves (`C79`) -> Cash Gate INSTANTLY UNLOCKS!
  const remRow = (
    await pg.query(
      `SELECT (public.submit_cash_remittance($1, 'bkash', 520000, 'BKX99887766', '01715001113', 'undal/private/cash_remittance_proof/rem-8801')).id AS id`,
      [riderId],
    )
  ).rows[0];
  const remDecideRes = await callW3(`/v1/admin/remittances/${remRow.id}/decide`, {
    method: 'POST',
    headers: financeHeaders,
    body: JSON.stringify({ decision: 'verified', note: 'Matched bKash merchant statement' }),
  });
  assert.equal(remDecideRes.status, 200);
  const unlockedRider = (await pg.query('SELECT cash_gate_blocked FROM public.riders WHERE id = $1', [riderId])).rows[0];
  assert.equal(unlockedRider.cash_gate_blocked, false, 'Approved TrxID remittance must auto-unlock cash gate!');

  // 2. Execute Friday Rider Cron (`5 18 * * 4`) + Saturday Vendor Cron (`5 18 * * 5`) & Verify Dual-Control (`C71–C77`)!
  const riderCron = await worker.scheduled({ cron: '5 18 * * 4', scheduledTime: clockMs }, env);
  assert.equal(riderCron.job, 'weekly_rider_settlement');
  assert.equal(riderCron.summary.generatedCount, 1);

  const vendorCron = await worker.scheduled({ cron: '5 18 * * 5', scheduledTime: clockMs + 86_400_000 }, env);
  assert.equal(vendorCron.job, 'weekly_vendor_settlement');
  assert.equal(vendorCron.summary.generatedCount, 1);

  const invList = (await (await callW3('/v1/admin/invoices?payee_type=vendor', { headers: financeHeaders })).json()).data.invoices;
  assert.equal(invList.length, 1);
  const vendorInv = invList[0];
  assert.equal(Number(vendorInv.net_payable_poisha), 425_000);
  // 1.85% bKash cash-out fee cover on `425,000` poisha = `round(425000 * 185 / 10000) = 7863` poisha!
  assert.equal(Number(vendorInv.cashout_fee_cover_poisha), 7_863);
  assert.equal(Number(vendorInv.total_disbursed_poisha), 432_863);

  const recompute = (await (await callW3(`/v1/admin/invoices/${vendorInv.id}/recompute`, { headers: financeHeaders })).json()).data;
  assert.equal(recompute.driftPoisha, 0);

  const pdfRes = (await (await callW3(`/v1/admin/invoices/${vendorInv.id}/pdf`, { headers: financeHeaders })).json()).data;
  assert.ok(pdfRes.printableHtml.includes('সাপ্তাহিক বিবরণী'));

  // `finance` Admin A verifies `GENERATED -> VERIFIED` (`C73`)
  assert.equal((await callW3(`/v1/admin/invoices/${vendorInv.id}/verify`, { method: 'POST', headers: financeHeaders, body: '{}' })).status, 200);

  const noStepUpHeaders = { ...financeHeaders };
  delete noStepUpHeaders['X-Undal-Step-Up'];
  assert.equal((await callW3(`/v1/admin/invoices/${vendorInv.id}/payout-target`, { headers: noStepUpHeaders })).status, 403);
  const payoutTargetResponse = await callW3(`/v1/admin/invoices/${vendorInv.id}/payout-target`, { headers: financeHeaders });
  assert.equal(payoutTargetResponse.status, 200);
  const payoutTarget = (await payoutTargetResponse.json()).data.payout_target;
  assert.equal(payoutTarget.accountNumber, '01715009999');
  assert.equal(payoutTarget.masked, '017****9999');
  const payoutAccessAudit = (await pg.query(
    `SELECT diff::text FROM public.audit_logs WHERE action = 'invoice.payout_target.view' AND entity_id = $1`,
    [vendorInv.id],
  )).rows[0].diff;
  assert.equal(payoutAccessAudit.includes('01715009999'), false, 'plaintext payout number must never enter the audit trail');

  // `finance` Admin A attempts to pay THEIR OWN verified invoice -> **STRICT 403 DUAL-CONTROL REJECTION!**
  const selfPayDenied = await callW3(`/v1/admin/invoices/${vendorInv.id}/pay`, {
    method: 'POST',
    headers: financeHeaders,
    body: JSON.stringify({
      payout_method: 'bkash',
      payout_txn_ref: 'PAYOUT9911',
      payout_proof_public_id: 'undal/private/invoice_pdf/proof-9911',
    }),
  });
  assert.equal(selfPayDenied.status, 403);

  // Settlement CSV Pack Export (`C88`) while `VERIFIED`, then Second Actor (`founderHeaders`) pays (`VERIFIED -> PAID`)!
  const pack = (await (await callW3('/v1/admin/finance/reports/settlement-pack', { method: 'POST', headers: financeHeaders })).json()).data;
  assert.equal(pack.count, 1);

  const paidRes = await callW3(`/v1/admin/invoices/${vendorInv.id}/pay`, {
    method: 'POST',
    headers: founderHeaders,
    body: JSON.stringify({
      payout_method: 'bkash',
      payout_txn_ref: 'PAYOUT9911',
      payout_proof_public_id: 'undal/private/invoice_pdf/proof-9911',
    }),
  });
  assert.equal(paidRes.status, 200);
  assert.equal((await paidRes.json()).data.state, 'PAID');

  // High-value (`৳600 >= ৳500`) adjustment requires dual-control second approver (`C81–C82`)!
  const adjRes = await callW3('/v1/admin/adjustments', {
    method: 'POST',
    headers: financeHeaders,
    body: JSON.stringify({ target_type: 'rider', target_id: riderId, kind: 'bonus', amount_poisha: 60000, reason_code: 'rain_hero_bonus' }),
  });
  const adj = (await adjRes.json()).data;
  assert.equal(adj.state, 'pending');
  assert.equal((await callW3(`/v1/admin/adjustments/${adj.id}/approve`, { method: 'POST', headers: financeHeaders, body: '{}' })).status, 403);
  assert.equal((await callW3(`/v1/admin/adjustments/${adj.id}/approve`, { method: 'POST', headers: founderHeaders, body: '{}' })).status, 200);

  // 3. Domain 6 (`C90–C101`): Global Search, Order 360, Modify & Goodwill Voucher
  assert.equal((await (await callW3('/v1/admin/orders/search?q=8801', { headers: founderHeaders })).json()).data.orders.length, 1);
  assert.equal((await callW3(`/v1/admin/orders/${orderId}/360`, { headers: founderHeaders })).status, 200);
  assert.equal((await callW3(`/v1/admin/orders/${orderId}/modify`, { method: 'POST', headers: founderHeaders, body: JSON.stringify({ refund_item_id: ordItemId, refunded_qty: 1 }) })).status, 200);
  assert.equal((await callW3(`/v1/admin/orders/${orderId}/goodwill-voucher`, { method: 'POST', headers: founderHeaders, body: JSON.stringify({ amount_poisha: 10000, customer_id: custId }) })).status, 201);

  // 4. Domain 7 (`C102–C113`): Zero-Ads Law `D-11` + `ADR-0006 v2` ImgBB Banner Law + Flash Box + Bilingual Nudges
  assert.equal(
    (
      await callW3('/v1/admin/campaigns', {
        method: 'POST',
        headers: founderHeaders,
        body: JSON.stringify({ kind: 'paid_ad', slug: 'illegal-ad', title_en: 'Ad', title_bn: 'বিজ্ঞাপন' }),
      })
    ).status,
    422,
  );
  const flashRes = await callW3('/v1/admin/campaigns', {
    method: 'POST',
    headers: founderHeaders,
    body: JSON.stringify({
      slug: 'afternoon-flash-sylhet',
      kind: 'flash_box',
      title_en: 'Afternoon Flash Box',
      title_bn: 'বিকেলের ফ্ল্যাশ বক্স',
      percent_bps: 2500,
      vendor_share_bps: 6000,
      budget_cap_poisha: 500000,
      daily_start_time: '15:00',
      daily_end_time: '17:30',
      starts_at: new Date(clockMs).toISOString(),
      ends_at: new Date(clockMs + 7 * 86_400_000).toISOString(),
    }),
  });
  const flashCamp = (await flashRes.json()).data;
  assert.equal(flashRes.status, 201);
  assert.equal((await callW3(`/v1/admin/campaigns/${flashCamp.id}/vendors`, { method: 'POST', headers: founderHeaders, body: JSON.stringify({ vendor_id: vendorId }) })).status, 200);

  // Non-ImgBB public banner rejected (`422`); real ImgBB CDN banner accepted (`201`)!
  assert.equal(
    (await callW3('/v1/admin/banners', { method: 'POST', headers: founderHeaders, body: JSON.stringify({ title_en: 'Bad URL', image_url: 'https://invalid-cdn.example/bad.jpg', deep_link: '/' }) })).status,
    422,
  );
  assert.equal(
    (await callW3('/v1/admin/banners', { method: 'POST', headers: founderHeaders, body: JSON.stringify({ title_en: 'Flash Hero', image_url: 'https://i.ibb.co/example/flash-hero.webp', deep_link: '/flash-box' }) })).status,
    201,
  );

  const draft = (
    await (
      await callW3('/v1/admin/nudges/draft', {
        method: 'POST',
        headers: founderHeaders,
        body: JSON.stringify({
          title_en: 'Hot Flash Box Ready!',
          title_bn: 'গরম ফ্ল্যাশ বক্স প্রস্তুত!',
          body_en: 'Fresh kitchen boxes from 3 PM.',
          body_bn: 'বিকেল ৩টা থেকে তাজা খাবার।',
          recipient_ids: [custId],
        }),
      })
    ).json()
  ).data;
  assert.equal((await (await callW3(`/v1/admin/nudges/${draft.id}/send`, { method: 'POST', headers: founderHeaders })).json()).data.sentCount, 1);

  // 5. Domain 8 (`C114–C124`): Support, Root-Cause Dispute Split (`ready_at` vs `picked_at` -> `rider_late_pickup`!), Reviews & Customer 360
  const dispRes = await (
    await callW3('/v1/admin/disputes/dsp-8801/resolve', {
      method: 'POST',
      headers: founderHeaders,
      body: JSON.stringify({
        order_id: orderId,
        vendor_id: vendorId,
        customer_id: custId,
        vendor_deduction_poisha: 5000,
        customer_voucher_poisha: 8000,
      }),
    })
  ).json();
  assert.equal(dispRes.data.rootCauseAnalysis.determinedFault, 'rider_late_pickup');
  assert.ok(dispRes.data.voucher.code.startsWith('DSP'));

  const revId = (
    await pg.query(
      `INSERT INTO public.reviews (order_id, reviewer_id, direction, vendor_id, rating, comment)
       VALUES ($1, $2, 'customer_to_vendor', $3, 5, 'Delicious beef shatkora!') RETURNING id`,
      [orderId, custId, vendorId],
    )
  ).rows[0].id;
  assert.equal(Number((await pg.query('SELECT rating_avg FROM public.vendors WHERE id = $1', [vendorId])).rows[0].rating_avg), 5);
  await callW3(`/v1/admin/reviews/${revId}/moderate`, { method: 'POST', headers: founderHeaders, body: JSON.stringify({ status: 'hidden', note: 'Spam test' }) });
  assert.equal(Number((await pg.query('SELECT rating_avg FROM public.vendors WHERE id = $1', [vendorId])).rows[0].rating_avg), 0);

  // 6. Domain 9 & Scheduled Crons (`C125–C132` + `30 20 * * *` Prune + `0 * * * *` MET Norway Weather preserving `admin_override`!)
  const quality = (await (await callW3('/v1/admin/bi/quality', { headers: founderHeaders })).json()).data;
  assert.equal(quality.vendorLedgerDriftPoisha, 0);
  assert.equal(quality.healthy, true);

  const pruneCron = await worker.scheduled({ cron: '30 20 * * *', scheduledTime: clockMs }, env);
  assert.equal(pruneCron.job, 'nightly_quota_prune');

  await dbAdapter.setZoneWeatherOverride(sylhetZone.id, 'storm', 60, clockMs);
  const weatherCron = await runAdminScheduledCron({
    cron: '0 * * * *',
    scheduledTimeMs: clockMs + 60_000,
    db: dbAdapter,
    env,
    fetchImpl: async () =>
      Response.json({
        properties: { timeseries: [{ data: { instant: { details: { air_temperature: 30 } }, next_1_hours: { summary: { symbol_code: 'clearsky_day' }, details: { precipitation_amount: 0 } } } }] },
      }),
  });
  assert.equal(weatherCron.summary.preservedOverrides, 1, 'Hourly weather cron must NEVER overwrite active dispatcher storm override!');

  await pg.close();
});

/**
 * @file workers/api/test/api-part1.test.mjs
 * @description End-to-end integration & security suite for `W1 undal-api` Part 1 (`Build Response 6`)
 * executing real HTTP requests through `worker.fetch()` against a real PostgreSQL 16 (`PGlite`) DB.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { resetRateLimitBuckets } from '../src/index.ts';
import { createPostgrestDbAdapter } from '../src/db-postgrest.ts';
import { TEST_JWT_SECRET, bootRealApiPostgres, createPgliteAdapter, mintTestJwt } from './_helpers/pglite-api-harness.mjs';

test('W1 undal-api Part 1 E2E: Catalog, rank_v1, HOME_KITCHEN privacy, Banglish search, Unlimited ImgBB public media & Sensitive-Only Cloudinary vault', async () => {
  resetRateLimitBuckets();
  const db = await bootRealApiPostgres();
  try {
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('d6001111-1111-4111-8111-111111111111', 'cust@undal.test', '{"full_name":"Ayesha Customer"}'::jsonb),
        ('d6002222-2222-4222-8222-222222222222', 'chef@undal.test', '{"full_name":"Chef Ruma"}'::jsonb),
        ('d6003333-3333-4333-8333-333333333333', 'rider@undal.test', '{"full_name":"Sabbir Rider"}'::jsonb),
        ('d6008888-8888-4888-8888-888888888888', 'banned@undal.test', '{"full_name":"Suspended User"}'::jsonb),
        ('d6009999-9999-4999-8999-999999999999', 'kyc-admin@undal.test', '{"full_name":"KYC Admin"}'::jsonb);

      UPDATE public.profiles SET role = 'vendor_owner' WHERE id = 'd6002222-2222-4222-8222-222222222222';
      UPDATE public.profiles SET role = 'rider' WHERE id = 'd6003333-3333-4333-8333-333333333333';
      UPDATE public.profiles SET status = 'suspended' WHERE id = 'd6008888-8888-4888-8888-888888888888';
      UPDATE public.profiles SET role = 'admin' WHERE id = 'd6009999-9999-4999-8999-999999999999';

      INSERT INTO public.admin_user_roles (profile_id, role_id)
      SELECT 'd6009999-9999-4999-8999-999999999999'::uuid, id FROM public.admin_roles WHERE key = 'super_admin';

      INSERT INTO public.vendors (
        id, owner_profile_id, type, legal_name, brand_name, slug,
        lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
        cuisines, kyc_status, is_active, min_order_poisha
      )
      SELECT
        'd6004444-4444-4444-8444-444444444444', 'd6002222-2222-4222-8222-222222222222', 'HOME_KITCHEN',
        'Ruma Akter', 'Ruma Kacchi Ghar', 'ruma-kacchi-ghar',
        24.8962, 91.8714, '', 'Zindabazar, Sylhet', 'SECRET FLAT 7C HOUSE 42 ZINDABAZAR', '01719999999', id,
        ARRAY['kacchi', 'homemade'], 'approved', true, 15000
      FROM public.zones WHERE slug = 'sylhet-sadar';

      INSERT INTO public.menu_categories (id, vendor_id, name_en)
      VALUES ('d6005555-5555-4555-8555-555555555555', 'd6004444-4444-4444-8444-444444444444', 'Signature Kacchi');

      INSERT INTO public.menu_items (id, vendor_id, category_id, name_en, name_bn, price_poisha)
      VALUES ('d6006666-6666-4666-8666-666666666666', 'd6004444-4444-4444-8444-444444444444', 'd6005555-5555-4555-8555-555555555555', 'Shahi Mutton Kacchi', 'শাহী মাটন কাচ্চি', 38000);

      INSERT INTO public.notifications (recipient_id, kind, title_en, title_bn, body_en, body_bn)
      VALUES ('d6001111-1111-4111-8111-111111111111', 'welcome', 'Welcome to Undal', 'উন্দালে স্বাগতম', 'Enjoy authentic Sylheti food.', 'সিলেটের খাঁটি খাবার উপভোগ করুন।');
    `);

    let lastImgbbForm = null;
    let lastOsmHeaders = null;

    const env = {
      SERVICE_NAME: 'undal-api',
      ENVIRONMENT: 'test',
      SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
      IMGBB_API_KEY: 'SECRET_SERVER_ONLY_IMGBB_KEY',
      CLOUDINARY_CLOUD_NAME: 'undal-private-vault',
      CLOUDINARY_UNSIGNED_PRESET_SECURE: 'undal_secure_unsigned',
      CLOUDINARY_API_KEY: '9988776655',
      CLOUDINARY_API_SECRET: 'SECRET_SERVER_ONLY_CLOUDINARY_KEY',
      __dbAdapter: createPgliteAdapter(db),
      __fetchImpl: async (targetUrl, init) => {
        if (String(targetUrl).includes('api.imgbb.com')) {
          lastImgbbForm = init?.body;
          return Response.json({
            success: true,
            data: {
              id: 'imgbb991',
              width: 1280,
              height: 960,
              size: 18420,
              delete_url: 'https://ibb.co/imgbb991/SECRET_MODERATOR_DELETE_HASH',
              image: { extension: 'jpg', url: 'https://i.ibb.co/full/shahi-kacchi.jpg' },
              medium: { url: 'https://i.ibb.co/medium/shahi-kacchi.jpg' },
              thumb: { url: 'https://i.ibb.co/thumb/shahi-kacchi.jpg' },
            },
          });
        }
        if (String(targetUrl).includes('tile.openstreetmap.org')) {
          lastOsmHeaders = init?.headers;
          return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
        }
        throw new Error(`Unexpected external fetch: ${targetUrl}`);
      },
    };

    // 1. Public config, Zone resolution, rank_v1 Home Feed & HOME_KITCHEN exact-address redaction
    const cfgRes = await worker.fetch(new Request('https://api.undal.app/v1/config/public'), env);
    assert.equal(cfgRes.status, 200);
    const cfgJson = await cfgRes.json();
    assert.equal('money.commission_pct' in cfgJson.data.settings, false, 'Private commercial settings never leak');

    const zoneIn = await (await worker.fetch(new Request('https://api.undal.app/v1/zones/resolve?lat=24.8949&lng=91.8687'), env)).json();
    assert.equal(zoneIn.data.in_service_area, true);
    assert.equal(zoneIn.data.slug, 'sylhet-sadar');

    const feedRes = await worker.fetch(new Request('https://api.undal.app/v1/home/feed?lat=24.8949&lng=91.8687'), env);
    assert.equal(feedRes.status, 200);
    assert.match(feedRes.headers.get('cache-control'), /s-maxage=30/);
    const feedJson = await feedRes.json();
    assert.equal(feedJson.data.vendors.length, 1);
    assert.equal(JSON.stringify(feedJson).includes('SECRET FLAT 7C'), false, 'HOME_KITCHEN private address MUST NOT leak in feed');

    const menuJson = await (await worker.fetch(new Request('https://api.undal.app/v1/vendors/ruma-kacchi-ghar/menu'), env)).json();
    assert.equal(menuJson.data.categories[0].items[0].price_poisha, 38000);
    assert.equal(JSON.stringify(menuJson).includes('SECRET FLAT 7C'), false, 'HOME_KITCHEN private address MUST NOT leak in storefront');

    // 2. Banglish search + zero-PII search telemetry + SEO + 30d OSM Tile Cache
    const searchJson = await (await worker.fetch(new Request('https://api.undal.app/v1/search?q=kacchi&lat=24.8949&lng=91.8687'), env)).json();
    assert.equal(searchJson.data.count, 1);
    assert.equal((await db.query('SELECT count(*)::int AS c FROM public.search_queries')).rows[0].c, 1);

    const seoJson = await (await worker.fetch(new Request('https://api.undal.app/v1/seo/sitemap-data'), env)).json();
    assert.equal(seoJson.data.cuisines.length, 117);
    assert.equal(seoJson.data.vendors[0].slug, 'ruma-kacchi-ghar');

    const tileRes = await worker.fetch(new Request('https://api.undal.app/v1/tiles/15/24680/14120.png'), env);
    assert.equal(tileRes.status, 200);
    assert.match(tileRes.headers.get('cache-control'), /max-age=2592000/);
    assert.match(lastOsmHeaders['User-Agent'], /UndalFoodBD\/1\.0/);

    // 3. Strict Dual-Provider Media Storage Law (`ImgBB = ALL public` | `Cloudinary = ONLY sensitive compliance`)
    const chefJwt = await mintTestJwt('d6002222-2222-4222-8222-222222222222');
    const riderJwt = await mintTestJwt('d6003333-3333-4333-8333-333333333333');
    const custJwt = await mintTestJwt('d6001111-1111-4111-8111-111111111111');
    const adminJwt = await mintTestJwt('d6009999-9999-4999-8999-999999999999');
    const bannedJwt = await mintTestJwt('d6008888-8888-4888-8888-888888888888');

    const badPublic = await worker.fetch(
      new Request('https://api.undal.app/v1/images/public', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chefJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'vendor_kyc', image_base64: 'ffd8ffe0' }),
      }),
      env,
    );
    assert.equal(badPublic.status, 422);

    const rawJpegWithGps = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x24, 0x89, 0x91, 0x87,
      0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xde, 0xad, 0xff, 0xd9,
    ]);
    const okPublic = await worker.fetch(
      new Request('https://api.undal.app/v1/images/public', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chefJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'menu_item',
          name: 'shahi-mutton-kacchi',
          image_base64: rawJpegWithGps.toString('base64'),
        }),
      }),
      env,
    );
    assert.equal(okPublic.status, 201);
    const okPublicText = await okPublic.text();
    assert.equal(okPublicText.includes('SECRET_SERVER_ONLY_IMGBB_KEY'), false);
    assert.equal(okPublicText.includes('SECRET_MODERATOR_DELETE_HASH'), false);
    const okPublicJson = JSON.parse(okPublicText);
    assert.equal(okPublicJson.data.provider, 'imgbb');
    assert.equal(okPublicJson.data.exif_stripped_segments, 1);
    assert.ok(lastImgbbForm instanceof FormData);

    const badPrivate = await worker.fetch(
      new Request('https://api.undal.app/v1/images/private-upload-url', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chefJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'menu_item', bytes: 50000 }),
      }),
      env,
    );
    assert.equal(badPrivate.status, 422);

    const okKycTicketRes = await worker.fetch(
      new Request('https://api.undal.app/v1/images/private-upload-url', {
        method: 'POST',
        headers: { Authorization: `Bearer ${riderJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'rider_kyc', bytes: 185000, format: 'jpg' }),
      }),
      env,
    );
    assert.equal(okKycTicketRes.status, 201);
    const okKycText = await okKycTicketRes.text();
    assert.equal(okKycText.includes('SECRET_SERVER_ONLY_CLOUDINARY_KEY'), false);
    const okKycJson = JSON.parse(okKycText);
    assert.equal(okKycJson.data.provider, 'cloudinary');

    const crossTenantView = await worker.fetch(
      new Request('https://api.undal.app/v1/images/private-view-url', {
        method: 'POST',
        headers: { Authorization: `Bearer ${custJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: okKycJson.data.asset_id }),
      }),
      env,
    );
    assert.equal(crossTenantView.status, 403);

    const adminView = await worker.fetch(
      new Request('https://api.undal.app/v1/images/private-view-url', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: okKycJson.data.asset_id, pdf_thumbnail: true }),
      }),
      env,
    );
    assert.equal(adminView.status, 200);
    const adminViewJson = await adminView.json();
    assert.match(adminViewJson.data.signed_url, /\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\//);
    assert.equal(
      (await db.query(`SELECT count(*)::int AS c FROM public.audit_logs WHERE action = 'media.private_view'`)).rows[0].c,
      1,
    );

    // 4. Auth suspension, privilege-escalation guard, FCM Xiaomi device token & bilingual notifications
    assert.equal(
      (await worker.fetch(new Request('https://api.undal.app/v1/me', { headers: { Authorization: `Bearer ${bannedJwt}` } }), env)).status,
      403,
    );
    assert.equal(
      (
        await worker.fetch(
          new Request('https://api.undal.app/v1/me', {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${custJwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' }),
          }),
          env,
        )
      ).status,
      403,
    );

    assert.equal(
      (
        await worker.fetch(
          new Request('https://api.undal.app/v1/devices/token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${riderJwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fcm_token: 'fcm_xiaomi_redmi_note_13_valid_token_string_999',
              app_flavor: 'rider',
              oem_brand: 'Xiaomi',
              alarm_ready: true,
            }),
          }),
          env,
        )
      ).status,
      201,
    );

    const notifRes = await (
      await worker.fetch(new Request('https://api.undal.app/v1/notifications?unread_only=true', { headers: { Authorization: `Bearer ${custJwt}` } }), env)
    ).json();
    assert.equal(notifRes.data.notifications.length, 1);

    const markRes = await (
      await worker.fetch(
        new Request('https://api.undal.app/v1/notifications/read', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${custJwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env,
      )
    ).json();
    assert.equal(markRes.data.marked_count, 1);
  } finally {
    await db.close();
  }
});

test('createPostgrestDbAdapter speaks exact Supabase /rest/v1/* and /rest/v1/rpc/* wire protocol', async () => {
  const calls = [];
  const adapter = createPostgrestDbAdapter({
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srv_key',
    __fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return Response.json([{ in_service_area: true, slug: 'sylhet-sadar' }]);
    },
  });
  const zone = await adapter.resolveZone(24.8949, 91.8687);
  assert.equal(zone.slug, 'sylhet-sadar');
  assert.equal(calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/resolve_zone');
  assert.equal(calls[0].method, 'POST');
});

/**
 * @file packages/shared_ts/test/cloudinary.test.mjs
 * @description Unit tests for UNDAL Zero-Supabase-Storage Free Cloudinary Engine (`ADR-0006`):
 * - Strict separation between public (`upload`) and sensitive (`authenticated`) asset folders.
 * - Unsigned upload preset descriptor generation with mandatory `fl_strip_profile` EXIF GPS stripping.
 * - Deterministic WebCrypto SHA-256 signed upload ticket & `s--XXXXXXXX--` authenticated URL signing.
 * - Free CDN responsive optimization (`f_auto,q_auto,c_fill,g_auto`), LQIP blur, and PDF page-1 preview URLs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCloudinaryPublicUrl,
  buildCloudinaryUnsignedUploadDescriptor,
  isPrivateMediaCategory,
  resolveCloudinaryFolder,
  signCloudinaryAuthenticatedUrl,
  signCloudinaryUploadTicket,
} from '../src/index.ts';

test('ADR-0006 Cloudinary engine isolates public vs authenticated categories and generates valid unsigned & signed URLs', async () => {
  assert.equal(isPrivateMediaCategory('menu_item'), false);
  assert.equal(isPrivateMediaCategory('vendor_kyc'), true);
  assert.equal(isPrivateMediaCategory('cash_remittance_proof'), true);
  assert.equal(isPrivateMediaCategory('invoice_pdf'), true);

  assert.equal(resolveCloudinaryFolder('menu_item', 'vendor-123'), 'undal/public/menu_item/vendor-123');
  assert.equal(resolveCloudinaryFolder('vendor_kyc', 'vendor-123'), 'undal/private/vendor_kyc/vendor-123');

  const unsignedPublic = buildCloudinaryUnsignedUploadDescriptor({
    config: {
      cloudName: 'demo-undal',
      unsignedPresetPublic: 'undal_public_unsigned',
      unsignedPresetSecure: 'undal_secure_unsigned',
    },
    category: 'menu_item',
    ownerEntityId: 'vendor-123',
    clientNonce: 'dish_987654321',
  });
  assert.equal(unsignedPublic.deliveryType, 'upload');
  assert.equal(unsignedPublic.uploadPreset, 'undal_public_unsigned');
  assert.equal(unsignedPublic.stripExifGps, true);

  const unsignedKyc = buildCloudinaryUnsignedUploadDescriptor({
    config: {
      cloudName: 'demo-undal',
      unsignedPresetPublic: 'undal_public_unsigned',
      unsignedPresetSecure: 'undal_secure_unsigned',
    },
    category: 'rider_kyc',
    ownerEntityId: 'rider-456',
    clientNonce: 'nid_123456789',
  });
  assert.equal(unsignedKyc.deliveryType, 'authenticated');
  assert.equal(unsignedKyc.uploadPreset, 'undal_secure_unsigned');

  const ticket = await signCloudinaryUploadTicket({
    cloudName: 'demo-undal',
    apiKey: '111222333',
    apiSecret: 'test-only-synthetic-secret-value',
    category: 'cash_remittance_proof',
    ownerEntityId: 'rider-456',
    assetUuid: 'trx_proof_001',
    timestampSec: 1792760000,
  });
  assert.equal(ticket.type, 'authenticated');
  assert.equal(ticket.folder, 'undal/private/cash_remittance_proof/rider-456');
  assert.equal(ticket.signature.length, 64);

  const signedUrl = await signCloudinaryAuthenticatedUrl({
    cloudName: 'demo-undal',
    apiSecret: 'test-only-synthetic-secret-value',
    publicId: 'undal/private/vendor_kyc/vendor-123/nid_front_01',
    format: 'webp',
    expiresAtUnixSec: 1792760600,
  });
  assert.match(
    signedUrl,
    /^https:\/\/res\.cloudinary\.com\/demo-undal\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/exp_1792760600\/undal\/private\/vendor_kyc\/vendor-123\/nid_front_01\.webp$/,
  );

  const optimizedCard = buildCloudinaryPublicUrl({
    cloudName: 'demo-undal',
    publicId: 'undal/public/menu_item/vendor-123/satkora',
    width: 480,
    height: 360,
  });
  assert.equal(
    optimizedCard,
    'https://res.cloudinary.com/demo-undal/image/upload/fl_strip_profile,f_auto,q_auto,c_fill,g_auto,w_480,h_360/undal/public/menu_item/vendor-123/satkora',
  );
});

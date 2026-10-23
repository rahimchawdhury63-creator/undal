import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PUBLIC_IMGBB_CATEGORIES,
  SENSITIVE_CLOUDINARY_CATEGORIES,
  buildCloudinaryFolder,
  buildCloudinaryUnsignedUploadDescriptor,
  isPrivateCloudinaryCategory,
  isPublicImgbbCategory,
  signCloudinaryAuthenticatedUrl,
  signCloudinaryUploadTicket,
  stripImageMetadataBytes,
  uploadPublicImageToImgbb,
} from '../src/index.ts';

test('ADR-0006 v2: strict dual-provider media split (ImgBB = ALL public unlimited | Cloudinary = ONLY sensitive private)', async () => {
  // 1. Disjoint completeness across all 13 platform categories
  for (const pub of PUBLIC_IMGBB_CATEGORIES) {
    assert.equal(isPublicImgbbCategory(pub), true);
    assert.equal(isPrivateCloudinaryCategory(pub), false);
    assert.throws(
      () =>
        buildCloudinaryUnsignedUploadDescriptor({
          cloudName: 'undal-bd',
          // @ts-expect-error testing runtime hard block on public category
          category: pub,
          ownerId: '11111111-1111-4111-8111-111111111111',
          secureUnsignedPreset: 'undal_secure_unsigned',
        }),
      /MUST use Unlimited ImgBB/,
    );
  }

  for (const sens of SENSITIVE_CLOUDINARY_CATEGORIES) {
    assert.equal(isPrivateCloudinaryCategory(sens), true);
    assert.equal(isPublicImgbbCategory(sens), false);
  }

  // 2. JPEG EXIF/GPS APP1 scrubber strips embedded coordinates while preserving valid JPEG SOS image stream!
  const fakeJpegWithExifGps = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, // APP0 JFIF (kept)
    0xff, 0xe1, 0x00, 0x0c, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x24, 0x89, 0x91, 0x87, // APP1 Exif GPS (stripped!)
    0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xff, 0xd9, // SOS + image scan + EOI (kept)
  ]);
  const scrubbed = stripImageMetadataBytes(fakeJpegWithExifGps);
  assert.equal(scrubbed.mime, 'image/jpeg');
  assert.equal(scrubbed.strippedMetadataSegments, 1);
  assert.equal(scrubbed.cleanBytes.byteLength, fakeJpegWithExifGps.byteLength - 14);

  // 3. ImgBB public upload proxy blocks sensitive categories & returns full/medium/thumb URLs
  await assert.rejects(
    () =>
      uploadPublicImageToImgbb({
        apiKey: 'imgbb_key',
        // @ts-expect-error runtime guard test
        category: 'rider_kyc',
        cleanBytes: scrubbed.cleanBytes,
        nameSlug: 'leak-attempt',
      }),
    /MUST use private Cloudinary storage/,
  );

  const uploaded = await uploadPublicImageToImgbb({
    apiKey: 'test_imgbb_api_key',
    category: 'menu_item',
    cleanBytes: scrubbed.cleanBytes,
    nameSlug: 'kacchi-platter',
    fetchImpl: async (_url, init) => {
      assert.ok(init?.body instanceof FormData);
      return Response.json({
        success: true,
        data: {
          id: 'k9XzQ21',
          width: 1200,
          height: 900,
          size: scrubbed.cleanBytes.byteLength,
          delete_url: 'https://ibb.co/k9XzQ21/secret_del_hash',
          image: { extension: 'jpg', url: 'https://i.ibb.co/full/kacchi.jpg' },
          medium: { url: 'https://i.ibb.co/medium/kacchi.jpg' },
          thumb: { url: 'https://i.ibb.co/thumb/kacchi.jpg' },
        },
      });
    },
  });
  assert.equal(uploaded.externalId, 'imgbb:k9XzQ21');
  assert.equal(uploaded.url, 'https://i.ibb.co/full/kacchi.jpg');
  assert.equal(uploaded.mediumUrl, 'https://i.ibb.co/medium/kacchi.jpg');
  assert.equal(uploaded.thumbUrl, 'https://i.ibb.co/thumb/kacchi.jpg');

  // 4. Sensitive Cloudinary unsigned preset & authenticated upload + short-lived s--XXXXXXXX-- view URL
  const folder = buildCloudinaryFolder('rider_kyc', '33333333-3333-4333-8333-333333333333');
  assert.equal(folder, 'undal/private/rider_kyc/33333333-3333-4333-8333-333333333333');

  const ticket = await signCloudinaryUploadTicket({
    cloudName: 'undal-bd',
    apiKey: '123456789',
    apiSecret: 'cloudinary_server_secret_test',
    category: 'cash_remittance_proof',
    ownerId: '33333333-3333-4333-8333-333333333333',
    assetUuid: 'aaaa1111-1111-4111-8111-111111111111',
    nowEpochSeconds: 1792761000,
  });
  assert.equal(ticket.deliveryType, 'authenticated');
  assert.equal(ticket.incomingTransformation, 'fl_strip_profile');
  assert.equal(ticket.signature.length, 64);

  const view = await signCloudinaryAuthenticatedUrl({
    cloudName: 'undal-bd',
    apiSecret: 'cloudinary_server_secret_test',
    publicId: ticket.publicId,
    ttlSeconds: 120,
    nowEpochSeconds: 1792761000,
    pdfPageThumbnail: true,
  });
  assert.match(view.signedUrl, /^https:\/\/res\.cloudinary\.com\/undal-bd\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/e_expires_1792761120\/fl_strip_profile\/pg_1/);
});

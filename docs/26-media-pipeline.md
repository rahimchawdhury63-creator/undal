<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 26 — Media Pipeline

> Two destinations, one rule. **imgbb for everything the public may see. Cloudinary for everything
> they must not.** The rule is enforced in the type system, not in a code review comment.

---

## 1. The classification

```kotlin
/**
 * Every upload in the platform declares its kind. The kind determines the
 * destination, and there is no API that lets a caller choose the destination
 * directly. A new kind must be added here, with a destination, before it can
 * be uploaded anywhere.
 */
enum class MediaKind(val destination: Destination, val retentionDays: Int?) {
    // ── Public: imgbb ────────────────────────────────────────────────
    VENDOR_COVER        (IMGBB, null),
    VENDOR_LOGO         (IMGBB, null),
    VENDOR_EXTERIOR     (IMGBB, null),
    MENU_ITEM           (IMGBB, null),
    CUISINE_ICON        (IMGBB, null),
    RIDER_PROFILE       (IMGBB, null),
    SHIFT_SELFIE        (IMGBB, 30),          // brief: selfie to imgbb
    SETTLEMENT_SELFIE   (IMGBB, 90),          // brief: selfie to imgbb
    PROMO_BANNER        (IMGBB, null),

    // ── Sensitive: Cloudinary, authenticated ─────────────────────────
    NID_FRONT           (CLOUDINARY, null),
    NID_BACK            (CLOUDINARY, null),
    NID_SELFIE          (CLOUDINARY, null),
    DRIVING_LICENCE     (CLOUDINARY, null),
    VEHICLE_REGISTRATION(CLOUDINARY, null),
    VEHICLE_INSURANCE   (CLOUDINARY, null),
    TRADE_LICENCE       (CLOUDINARY, null),
    TIN_CERTIFICATE     (CLOUDINARY, null),
    FOOD_SAFETY_CERT    (CLOUDINARY, null),
    KITCHEN_PHOTO       (CLOUDINARY, null),   // may contain staff
    BANK_STATEMENT      (CLOUDINARY, 365),
    SETTLEMENT_SCREENSHOT(CLOUDINARY, 365),
    DISPUTE_EVIDENCE    (CLOUDINARY, 365),
    INVOICE_PDF         (CLOUDINARY, null),
    SUPPORT_ATTACHMENT  (CLOUDINARY, 365),
}
```

Two tests guard this:
- Every `MediaKind` has a destination and an explicit retention decision (`null` means
  "while the account is active", and that is a decision, not an omission).
- The imgbb client **rejects any kind whose destination is not `IMGBB`**, and vice versa, at the
  call site, with a compile-time-checkable discriminated union in TypeScript and a sealed type in
  Kotlin.

A `media-destination` CI job walks every upload call site and asserts the kind is a literal, not a
variable — because a variable kind is a variable destination, which is how a national ID card ends
up on a public CDN.

---

## 2. Why these two services

| | imgbb | Cloudinary |
| --- | --- | --- |
| Cost | Free, unlimited | Free tier: 25 GB storage, 25 GB bandwidth/month |
| Auth | API key | Unsigned upload preset |
| Access control | **None — every URL is public** | `access_mode: authenticated`, signed expiring URLs |
| Transformations | Fixed set of sizes returned at upload | Full on-the-fly transformation |
| Suited to | Food photography, logos, avatars | Identity documents, financial evidence, PDFs |

imgbb having no access control is precisely why it may only ever hold things that are already
public. The brief's split is the right one and the implementation makes it unbreakable.

---

## 3. The upload path

Clients **never** hold an imgbb key or a Cloudinary preset. Every upload is proxied through
`undal-core`.

```
Client                      undal-core                   imgbb / Cloudinary
  │                              │                              │
  ├─ POST /v1/media/intent ─────▶│                              │
  │    {kind, mime, bytes, sha}  │                              │
  │                              ├─ validate kind + quota       │
  │                              ├─ create media_assets row     │
  │◀──── {uploadId, maxBytes} ───┤    state = PENDING           │
  │                              │                              │
  ├─ POST /v1/media/{id} ───────▶│                              │
  │    multipart, the bytes      ├─ sniff magic bytes           │
  │                              ├─ re-encode (strip EXIF)      │
  │                              ├─ enforce dimension caps      │
  │                              ├─ compute blurhash            │
  │                              ├──── upload ─────────────────▶│
  │                              │◀─── url, deleteUrl ──────────┤
  │                              ├─ state = READY               │
  │◀──── {url, blurhash, w, h} ──┤                              │
```

### 3.1 Why proxy

| Reason | Detail |
| --- | --- |
| **Secrets** | An API key in an APK is a public API key. `IMGBB_API_KEY` and the Cloudinary preset live only in the Worker |
| **Validation** | Magic-byte sniffing, not trusting `Content-Type`. A `.jpg` that is actually an HTML file is rejected |
| **EXIF** | Stripped server-side, always. A menu photo should not carry the kitchen's GPS coordinates |
| **Re-encoding** | Every image is decoded and re-encoded, which neutralises polyglot files and malformed-header exploits |
| **Quota** | Per-actor rate and volume limits, enforced before a byte reaches a third party |
| **Audit** | Every upload has a row with the actor, kind, size, hash and timestamp |
| **Deletion** | The `deleteUrl` from imgbb is stored, so retention policies can actually be executed |

### 3.2 Processing in the Worker

Cloudflare Workers have no native image library, so processing uses:

| Operation | Implementation |
| --- | --- |
| Decode / encode | `@jsquash/jpeg`, `@jsquash/png`, `@jsquash/webp` — WASM codecs, ~180 KB each, loaded lazily per format |
| Resize | `@jsquash/resize` (Lanczos3) |
| Blurhash | `blurhash` WASM over a 32×32 downscale |
| Magic bytes | A 32-byte header check against a signature table |
| HEIC | Decoded on-device in the Android app before upload; the Worker rejects HEIC |

Worker CPU per image: **p50 180 ms, p99 420 ms** for a 1 600 px JPEG, inside the 50 ms CPU /
unlimited wall-clock model because codec time is mostly in WASM.

---

## 4. Size and dimension policy

| Kind | Client pre-compression | Server cap | Final |
| --- | --- | --- | --- |
| `MENU_ITEM` | 1 200 px, q85 | 1 600 px | ≤ 180 KB WebP + JPEG fallback |
| `VENDOR_COVER` | 1 600 px, q85 | 2 000 px | ≤ 280 KB |
| `VENDOR_LOGO` | 600 px, q90 | 800 px | ≤ 90 KB |
| `RIDER_PROFILE` | 600 px, q85 | 800 px | ≤ 80 KB |
| `SHIFT_SELFIE` | 800 px, q80 | 1 000 px | ≤ 120 KB |
| Documents | 1 600 px, q88 | 2 400 px | ≤ 500 KB |
| `SETTLEMENT_SCREENSHOT` | native, q92 | 2 400 px | ≤ 600 KB — text must stay readable |

Client-side pre-compression is what makes this work on a 3G connection: a 4 MB camera photo
becomes a 180 KB upload before it leaves the phone. On Android this uses `ImageDecoder` with a
target size; on the web, a `canvas` resize.

### 4.1 Serving

imgbb returns several URLs at upload (`url`, `display_url`, `thumb`, `medium`). All are stored.
The client picks by context and measured bandwidth:

| Context | Variant |
| --- | --- |
| Vendor card in a list | `medium` (~400 px) |
| Vendor hero | `display_url` |
| Menu item thumbnail | `thumb` (~180 px) |
| Menu item sheet | `medium` |
| On `Save-Data` or `2g` | Always `thumb`, and the hero is suppressed |

Blurhash renders first in every case, so there is never a grey rectangle or a layout shift.

---

## 5. Cloudinary specifics

| Setting | Value |
| --- | --- |
| Upload | Unsigned preset `undal_sensitive`, restricted to a folder per actor type |
| Access mode | `authenticated` — the raw URL returns 401 |
| Delivery | Signed URL, **5-minute expiry**, generated per view by the Worker |
| Folder | `undal/{env}/{actorType}/{actorId}/{kind}/{uuid}` |
| Transformations | Disabled on delivery for documents (a transformation URL is a different signature surface); invoices are delivered as stored |
| Moderation | Off — a human reviews every document anyway |
| Backup | Cloudinary's own; the platform additionally stores the SHA-256 of every document so tampering is detectable |

### 5.1 Every view is audited

```ts
async function signedDocumentUrl(assetId: string, viewer: AdminActor, reason: string) {
  const asset = await db.mediaAssets.get(assetId);
  requirePermission(viewer, `kyc.document.view.${asset.kind}`);
  await audit.write({
    action: "MEDIA_VIEW", resource: assetId, actor: viewer.id,
    subject: asset.ownerId, reason, kind: asset.kind,
  });
  return cloudinary.signedUrl(asset.publicId, { expiresIn: 300 });
}
```

A reason is required for every sensitive-document view. This is a small friction that produces a
real audit trail, and it is the difference between "staff can see IDs" and "we know exactly who
looked at whose ID, and why".

---

## 6. Camera capture

### 6.1 Android

CameraX, with a per-kind configuration:

| Kind | Lens | Guide | On-device checks |
| --- | --- | --- | --- |
| Menu item | Rear | Square/4:3 frame with a rule-of-thirds overlay | Blur (Laplacian variance), exposure, a "move closer" hint if the dish occupies < 40% |
| Document | Rear | Rectangle with corner markers and edge detection | All four corners visible, glare detection, ≥ 800 px short edge, perspective correction offered |
| Selfie | Front | Oval | Face present, eyes open, 25–70% frame fill, brightness, blur |
| Settlement screenshot | Picker | — | OCR pre-check that a TrxID-shaped string is present |

Every check is **advisory with a hard override**. Three failures and the app accepts the image
anyway, flagged for manual review. A heuristic must never be the reason somebody cannot work.

### 6.2 Web

`<input type="file" accept="image/*" capture="environment">`, with the same canvas-based
compression and a lighter client-side quality check.

---

## 7. Invoice PDFs

Generated by `pdf-lib` inside `undal-core` ([`24 §7`](24-finance-payouts-invoices.md)), uploaded
to Cloudinary as `INVOICE_PDF`, delivered by signed URL.

| Property | Value |
| --- | --- |
| Size | 180–340 KB typical, hard cap 1 MB |
| Fonts | Subsetted Poppins + Hind Siliguri, ~38 KB |
| Charts | Vector, drawn with `pdf-lib`'s path API |
| Metadata | Title, author `Undal`, the invoice number, and the ledger `content_hash` |
| Determinism | Byte-identical on regeneration — the generator takes no timestamp and no random seed; the creation date is set to the period close, not to `now()` |
| Access | The party themselves, plus `FINANCE` and above. Every access audited |

---

## 8. Retention and deletion

| Kind | Retention | Deletion mechanism |
| --- | --- | --- |
| `SHIFT_SELFIE` | **30 days** | Request-triggered housekeeping; the stored imgbb `deleteUrl` is called, then the row is tombstoned |
| `SETTLEMENT_SELFIE` | 90 days | Same |
| `SETTLEMENT_SCREENSHOT` | 365 days | Cloudinary destroy |
| Documents | While active, then **90 days** after offboarding | Cloudinary destroy |
| `DISPUTE_EVIDENCE` | 365 days after resolution | Cloudinary destroy |
| Menu and vendor images | While the item or vendor exists, then 30 days | imgbb delete |
| On account deletion | Everything except what law or an open dispute requires, within 24 hours | Both |

Housekeeping is **request-triggered**, not cron: on any admin finance or KYC request, a bounded
batch of at most 50 expired assets is processed. At the platform's volume this clears the backlog
many times over each day, and it costs nothing when there is nothing to do.

Every deletion writes an audit row. A deletion that fails (imgbb's delete URL has been known to
404) is retried three times, then flagged for manual handling — and the row is kept marked
`DELETE_FAILED` rather than silently tombstoned, because pretending data is gone when it is not is
the worst possible outcome.

---

## 9. Failure handling

| Failure | Behaviour |
| --- | --- |
| imgbb is down | Three retries with backoff, then the upload fails with a clear message and the client keeps the local file for a later retry. Menu editing continues without the photo |
| Cloudinary is down | Same, but **onboarding cannot proceed** without the document; the applicant's progress is saved and they are told to return |
| Quota exceeded | Admin exception; uploads of non-critical kinds (menu photos) are paused first, documents last |
| Corrupt upload | Re-encoding fails → rejected with a specific message, never stored |
| Oversized | Rejected at `intent` before bytes are sent, saving the user's data |
| Duplicate | The SHA-256 is checked; an identical image from the same actor returns the existing URL rather than re-uploading |

---

## 10. Abuse prevention

| Control | Value |
| --- | --- |
| Rate limit | 30 uploads/hour per actor, 200/day |
| Total volume | 100 MB/day per vendor, 20 MB/day per rider |
| Content | No moderation API (none is free and reliable); instead, every public image appears in an admin moderation queue before it goes live for a vendor's first 10 uploads, and randomly at 5% thereafter |
| Reporting | Customers can report an image; two reports pull it from display pending review |
| File types | JPEG, PNG, WebP only. No SVG (scriptable), no GIF, no HEIC server-side, no PDF except generated invoices |
| Dimensions | Minimum 200 px, maximum 4 000 px; a 30 000 × 1 px decompression bomb is rejected at the header check |

---

## 11. Testing

| Test | Count |
| --- | --- |
| Kind → destination routing | 24 — every `MediaKind` |
| `media-destination` CI job | 1 — no variable kinds at any call site |
| Magic-byte sniffing against a 60-file adversarial fixture set | 60 |
| EXIF stripping, including GPS | 12 |
| Re-encoding neutralises 8 known polyglot payloads | 8 |
| Compression targets per kind | 24 |
| Blurhash generation and rendering | 7 |
| Signed URL expiry and 401 on the raw URL | 9 |
| Audit on every sensitive view | 1 CI job |
| Retention execution, including the `DELETE_FAILED` path | 16 |
| Duplicate detection by hash | 5 |
| Rate and volume limits | 11 |
| Decompression-bomb rejection | 4 |
| Offline capture and deferred upload | 9 |
| PDF determinism and size cap | 14 |

---

## 12. Reading on

Next: [`27-security-rbac-audit.md`](27-security-rbac-audit.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*

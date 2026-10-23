# 15 · Image System — ImgBB (public) + Private Vault (sensitive)

## 15.1 Two-lane law (D-02/D-03)

| Lane | Content | Destination | Access |
|---|---|---|---|
| **PUBLIC** | Menu item photos, vendor logo/cover, kitchen/storefront photos, review photos, banners, avatars | **ImgBB** via W1 proxy | Public CDN URL stored in Postgres |
| **PRIVATE** | NID/passport, trade licence, TIN/BIN, bank proofs, driving licence, vehicle papers, selfies, bKash screenshots, payout proofs, invoice PDFs | **Supabase Storage private buckets** | Worker-minted signed URLs ≤10 min, owner + authorised Admin roles only |

**SVG-conversion lane: rejected** (photos are raster; “SVG in DB” bloats Postgres, breaks the 500 MB budget, adds XSS surface).
**Cloudinary unsigned presets for sensitive docs: rejected** (anyone can upload; URLs are public). If private storage ever
outgrows 1 GB free, overflow = Cloudinary **signed** uploads (Worker signs; `type=authenticated`) — runbook in Plan Response 1 ADR space.

## 15.2 ImgBB upload pipeline (no official Android SDK — we build the client properly)

Contract (documented ImgBB API): `POST https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}` with form field `image`
(base64 or binary) + optional `name`, `expiration`. **Undal flow (key never leaves W1):**
1. Client (Flutter/React): pick/capture → **compress locally** (max edge 1600 px, JPEG/WebP q80, target ≤800 KB, EXIF stripped)
   → `POST W1 /v1/images/public` (multipart) with auth + `purpose` enum.
2. W1: auth/role check (vendor owns vendor, etc.), magic-byte sniff (JPEG/PNG/WebP only), size/dimension caps, rate-limit
   (30/day/vendor default, setting), forwards to ImgBB with secret key, timeout 10 s, retries ×2.
3. W1 stores `{url, delete_url_hash, width, height, purpose, owner}` in `media_assets` (delete URL never returned to clients)
   → returns public URL → client saves it in the owning record.
4. Replacement/deletion: W1 marks asset retired (ImgBB free deletion is best-effort — never put sensitive content here, ever).
Resilience: ImgBB down → upload queues locally with “will publish when back” (menu item saves with pending-image state,
placeholder *generated brand tile* shown — clearly a designed state, not a broken image).

## 15.3 Private vault pipeline

Client requests `POST W1 /v1/images/private-upload-url {doc_type, owner context}` → ownership/KYC-state check →
Supabase Storage signed upload URL (bucket `kyc-private` / `proofs-private`, path `{profile_id}/{doc_type}/{uuid}.jpg`,
content-type locked, ≤5 MB, PDF allowed for licences) → client uploads direct to Supabase (bytes never transit Workers) →
registers `*_documents` row. Viewing: `POST /private-view-url` (owner or Admin permission `kyc.view`) → 10-min signed URL +
audit log entry (who saw which NID, when — compliance gold). Client-side doc capture UX: edge-guide overlay, blur/glare
warnings (basic Laplacian check in Dart), retake flow — fewer Admin rejections.

## 15.4 Freshness, abuse, cost

Vendor cover/logo guidelines enforced by Admin moderation sampling; reported-image takedown switches URL → brand tile instantly
(DB-level). Review photos: 3/order, same pipeline. Chat images: private lane (order participants only), 90-day expiry job.
Monthly media report in Admin (assets by lane/purpose) keeps free quotas visible.

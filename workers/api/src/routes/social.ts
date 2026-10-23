/**
 * @file workers/api/src/routes/social.ts
 * @description Verified completed-order reviews (`/v1/orders/:id/review`, `/v1/reviews/:id/reply`),
 * active-order participant chat with `24h` post-terminal lock & phone/link shield (`/v1/chats/:orderId/messages`),
 * and unified Customer/Partner/Rider support tickets (`/v1/support/threads*`) (`Build Response 7`).
 */

import { requireIdempotencyKey } from '../domain-errors.ts';
import { jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, AuthPrincipal } from '../types.ts';

type PairKind = 'customer_rider' | 'customer_vendor' | 'rider_vendor';

function parsePairKind(raw: string | null | undefined): PairKind | null {
  if (!raw || raw === 'customer_rider' || raw === 'c_r') return 'customer_rider';
  if (raw === 'customer_vendor' || raw === 'c_v') return 'customer_vendor';
  if (raw === 'rider_vendor' || raw === 'r_v') return 'rider_vendor';
  return null;
}

/** Handles `/v1/orders/:id/review`, `/v1/reviews/:id/reply`, `/v1/chats/:orderId/messages`, and `/v1/support/threads*`. */
export async function handleSocialRoute(
  request: Request,
  url: URL,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  const orderReviewMatch = /^\/v1\/orders\/([0-9a-f-]{36})\/review$/i.exec(path);
  const reviewReplyMatch = /^\/v1\/reviews\/([0-9a-f-]{36})\/reply$/i.exec(path);
  const chatMatch = /^\/v1\/chats\/([0-9a-f-]{36})\/messages$/i.exec(path);
  const supportMessagesMatch = /^\/v1\/support\/threads\/([0-9a-f-]{36})\/messages$/i.exec(path);
  const isSupportRoot = path === '/v1/support/threads';

  if (!orderReviewMatch && !reviewReplyMatch && !chatMatch && !supportMessagesMatch && !isSupportRoot) {
    return null;
  }
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  if (orderReviewMatch && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const body = (await request.json().catch(() => null)) as {
      readonly direction?: 'customer_to_vendor' | 'customer_to_rider' | 'rider_to_vendor' | 'vendor_to_customer';
      readonly rating?: number;
      readonly aspect_tags?: readonly string[];
      readonly comment?: string | null;
      readonly photo_urls?: readonly string[];
    } | null;

    const rating = Number(body?.rating);
    const direction = body?.direction ?? 'customer_to_vendor';
    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5 ||
      !['customer_to_vendor', 'customer_to_rider', 'rider_to_vendor', 'vendor_to_customer'].includes(direction)
    ) {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['rating(1..5)'] });
    }

    const photoUrls = Array.isArray(body?.photo_urls)
      ? body.photo_urls.filter((u): u is string => typeof u === 'string')
      : [];
    if (photoUrls.length > 4 || photoUrls.some((u) => !u.startsWith('https://i.ibb.co/'))) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        field: 'photo_urls',
        hint: 'Public review photos must be hosted on Unlimited Free ImgBB (https://i.ibb.co/*) via POST /v1/images/public.',
      });
    }

    const review = await db.submitOrderReview({
      orderId: orderReviewMatch[1]!,
      reviewerId: principal.sub,
      direction,
      rating,
      aspectTags: Array.isArray(body?.aspect_tags)
        ? body.aspect_tags.filter((t): t is string => typeof t === 'string').slice(0, 8)
        : [],
      comment: typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : null,
      photoUrls,
    });
    return jsonOk({ review }, requestId, 201);
  }

  if (reviewReplyMatch && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    const body = (await request.json().catch(() => null)) as { readonly reply?: string } | null;
    if (!body?.reply || typeof body.reply !== 'string' || body.reply.trim().length < 2 || body.reply.trim().length > 600) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'reply' });
    }
    const updated = await db.replyToReview(reviewReplyMatch[1]!, principal.sub, body.reply.trim());
    if (!updated) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    return jsonOk({ review: updated }, requestId);
  }

  if (chatMatch) {
    const orderId = chatMatch[1]!;
    const ctx = await db.getOrderAccessContext(orderId, principal.sub);
    if (!ctx) return jsonErr('VALIDATION_FAILED', requestId, { domain_reason: 'ORDER_NOT_FOUND' }, undefined, 404);

    const isCustomer = ctx.order.customer_id === principal.sub;
    const isVendor = ctx.vendor.owner_profile_id === principal.sub || ctx.staffRole !== null;
    const isRider = ctx.riderProfileId === principal.sub;
    const isAdmin = principal.role === 'admin';

    if (!isCustomer && !isVendor && !isRider && !isAdmin) {
      return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    }

    if (request.method === 'GET') {
      const pairKind = parsePairKind(url.searchParams.get('pair'));
      if (!pairKind) return jsonErr('VALIDATION_FAILED', requestId, { field: 'pair' });
      if (!isAdmin) {
        const pairAllowed =
          (pairKind === 'customer_rider' && (isCustomer || isRider)) ||
          (pairKind === 'customer_vendor' && (isCustomer || isVendor)) ||
          (pairKind === 'rider_vendor' && (isRider || isVendor));
        if (!pairAllowed) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
      }
      const data = await db.listOrderChatMessages(orderId, pairKind);
      return jsonOk(data, requestId, 200, { 'Cache-Control': 'private, no-store' });
    }

    if (request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        readonly pair?: string;
        readonly body?: string | null;
        readonly media_public_id?: string | null;
        readonly voice_duration_sec?: number | null;
      } | null;

      const pairKind = parsePairKind(body?.pair);
      if (!pairKind) return jsonErr('VALIDATION_FAILED', requestId, { field: 'pair' });
      const pairAllowed =
        (pairKind === 'customer_rider' && (isCustomer || isRider)) ||
        (pairKind === 'customer_vendor' && (isCustomer || isVendor)) ||
        (pairKind === 'rider_vendor' && (isRider || isVendor));
      if (!pairAllowed) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);

      const textBody = typeof body?.body === 'string' && body.body.trim().length > 0 ? body.body.trim().slice(0, 1000) : null;
      const mediaPublicId = typeof body?.media_public_id === 'string' && body.media_public_id.trim().length > 0
        ? body.media_public_id.trim()
        : null;
      if (!textBody && !mediaPublicId) {
        return jsonErr('VALIDATION_FAILED', requestId, { required: ['body_or_media_public_id'] });
      }
      if (mediaPublicId && !mediaPublicId.startsWith('undal/private/chat_attachment/')) {
        return jsonErr('VALIDATION_FAILED', requestId, {
          field: 'media_public_id',
          hint: 'Chat attachments must live in Cloudinary Private Vault (undal/private/chat_attachment/*).',
        });
      }

      const msg = await db.postOrderChatMessage({
        orderId,
        pairKind,
        senderId: principal.sub,
        body: textBody,
        mediaPublicId,
        voiceDurationSec: typeof body?.voice_duration_sec === 'number' ? body.voice_duration_sec : null,
      });
      return jsonOk({ message: msg }, requestId, 201);
    }
    return null;
  }

  if (isSupportRoot) {
    if (request.method === 'GET') {
      const threads = await db.listSupportThreads(principal.sub, principal.role === 'admin');
      return jsonOk({ threads }, requestId, 200, { 'Cache-Control': 'private, no-store' });
    }
    if (request.method === 'POST') {
      if (!requireIdempotencyKey(request)) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
      const body = (await request.json().catch(() => null)) as {
        readonly order_id?: string | null;
        readonly category?: string;
        readonly subject?: string;
        readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
        readonly body?: string;
        readonly attachment_public_ids?: readonly string[];
      } | null;

      if (
        !body?.category || body.category.trim().length < 2 ||
        !body.subject || body.subject.trim().length < 3 ||
        !body.body || body.body.trim().length < 2
      ) {
        return jsonErr('VALIDATION_FAILED', requestId, { required: ['category', 'subject', 'body'] });
      }
      const attachments = Array.isArray(body.attachment_public_ids)
        ? body.attachment_public_ids.filter((x): x is string => typeof x === 'string')
        : [];
      if (attachments.some((p) => !p.startsWith('undal/private/'))) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'attachment_public_ids' });
      }
      const requesterRole =
        principal.role === 'vendor_owner' || principal.role === 'vendor_staff' || principal.role === 'rider'
          ? principal.role
          : 'customer';
      const created = await db.createSupportThread({
        requesterId: principal.sub,
        requesterRole,
        orderId: typeof body.order_id === 'string' ? body.order_id : null,
        category: body.category.trim(),
        subject: body.subject.trim(),
        priority: body.priority ?? 'normal',
        initialBody: body.body.trim(),
        attachmentPublicIds: attachments,
      });
      return jsonOk(created, requestId, 201);
    }
    return null;
  }

  if (supportMessagesMatch) {
    const threadId = supportMessagesMatch[1]!;
    if (request.method === 'GET') {
      const messages = await db.listSupportMessages(threadId, principal.sub, principal.role === 'admin');
      if (!messages) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
      return jsonOk({ messages }, requestId, 200, { 'Cache-Control': 'private, no-store' });
    }
    if (request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        readonly body?: string;
        readonly attachment_public_ids?: readonly string[];
      } | null;
      if (!body?.body || body.body.trim().length < 1) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'body' });
      }
      const attachments = Array.isArray(body.attachment_public_ids)
        ? body.attachment_public_ids.filter((x): x is string => typeof x === 'string')
        : [];
      if (attachments.some((p) => !p.startsWith('undal/private/'))) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'attachment_public_ids' });
      }
      const msg = await db.postSupportMessage({
        threadId,
        senderId: principal.sub,
        isAdmin: principal.role === 'admin',
        body: body.body.trim(),
        attachmentPublicIds: attachments,
      });
      if (!msg) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
      return jsonOk({ message: msg }, requestId, 201);
    }
  }

  return null;
}

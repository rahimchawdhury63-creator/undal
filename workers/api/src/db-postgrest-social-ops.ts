/**
 * @file workers/api/src/db-postgrest-social-ops.ts
 * @description Supabase PostgREST + RPC HTTP methods for reviews, order chat, support threads,
 * and Partner/Rider self-service endpoints on `W1 undal-api` (`Build Response 7`).
 */

import type { PostgrestTransport } from './db-postgrest-ops.ts';
import type { ApiDbAdapter } from './types.ts';

type SocialOpsKeys =
  | 'submitOrderReview' | 'replyToReview'
  | 'listOrderChatMessages' | 'postOrderChatMessage'
  | 'listSupportThreads' | 'createSupportThread' | 'listSupportMessages' | 'postSupportMessage'
  | 'getOperatorVendor' | 'updateOperatorVendor' | 'upsertMenuCategory'
  | 'upsertMenuItem' | 'submitVendorKycDoc' | 'getVendorFinanceSummary'
  | 'getRiderCashGateByProfile' | 'getRiderSelfProfile'
  | 'submitRiderKycDoc' | 'submitRiderRemittance' | 'getRiderFinanceSummary';

/** Builds social, chat, support, and Partner/Rider self-service PostgREST methods. */
export function createPostgrestSocialOpsMethods(t: PostgrestTransport): Pick<ApiDbAdapter, SocialOpsKeys> {
  return {
    async getRiderCashGateByProfile(profileId) {
      const rows = await t.getJson<Record<string, unknown>[]>(
        `rider_cash_balance_v?profile_id=eq.${encodeURIComponent(profileId)}&limit=1`,
      );
      return rows[0] ?? null;
    },

    async submitOrderReview(input) {
      const rows = await t.sendJson<Record<string, unknown>[]>('POST', 'reviews', {
        order_id: input.orderId,
        reviewer_id: input.reviewerId,
        direction: input.direction,
        rating: input.rating,
        aspect_tags: input.aspectTags,
        comment: input.comment,
        photo_urls: input.photoUrls,
      });
      return rows[0] ?? {};
    },

    async replyToReview(reviewId, vendorOperatorId, replyText) {
      const op = await this.getOperatorVendor(vendorOperatorId);
      if (!op) return null;
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'PATCH',
        `reviews?id=eq.${encodeURIComponent(reviewId)}&vendor_id=eq.${encodeURIComponent(String(op.vendor.id))}`,
        { vendor_reply: replyText, vendor_replied_at: new Date().toISOString() },
      );
      return rows[0] ?? null;
    },

    async listOrderChatMessages(orderId, pairKind) {
      const chats = await t.getJson<Record<string, unknown>[]>(
        `chats?order_id=eq.${encodeURIComponent(orderId)}&pair_kind=eq.${encodeURIComponent(pairKind)}&limit=1`,
      );
      const chat = chats[0] ?? null;
      if (!chat || typeof chat.id !== 'string') return { chat: null, messages: [] };
      const messages = await t.getJson<Record<string, unknown>[]>(
        `chat_messages?chat_id=eq.${encodeURIComponent(chat.id)}&order=created_at.asc`,
      );
      return { chat, messages };
    },

    async postOrderChatMessage(input) {
      const chats = await t.sendJson<Record<string, unknown>[]>(
        'POST',
        'chats?on_conflict=order_id,pair_kind',
        { order_id: input.orderId, pair_kind: input.pairKind },
        'resolution=merge-duplicates,return=representation',
      );
      const rows = await t.sendJson<Record<string, unknown>[]>('POST', 'chat_messages', {
        chat_id: chats[0]!.id,
        sender_id: input.senderId,
        body: input.body,
        media_public_id: input.mediaPublicId,
        voice_duration_sec: input.voiceDurationSec,
      });
      return rows[0] ?? {};
    },

    async listSupportThreads(requesterId, isAdmin) {
      const filter = isAdmin
        ? 'order=created_at.desc&limit=50'
        : `requester_id=eq.${encodeURIComponent(requesterId)}&order=created_at.desc&limit=50`;
      return await t.getJson<Record<string, unknown>[]>(`support_threads?${filter}`);
    },

    async createSupportThread(input) {
      const threads = await t.sendJson<Record<string, unknown>[]>('POST', 'support_threads', {
        requester_id: input.requesterId,
        requester_role: input.requesterRole,
        order_id: input.orderId,
        category: input.category,
        subject: input.subject,
        priority: input.priority,
      });
      const thread = threads[0]!;
      const msgs = await t.sendJson<Record<string, unknown>[]>('POST', 'support_messages', {
        thread_id: thread.id,
        sender_id: input.requesterId,
        is_internal_note: false,
        body: input.initialBody,
        attachment_public_ids: input.attachmentPublicIds,
      });
      return { thread, message: msgs[0]! };
    },

    async listSupportMessages(threadId, viewerId, isAdmin) {
      const threads = await t.getJson<Array<{ requester_id: string }>>(
        `support_threads?id=eq.${encodeURIComponent(threadId)}&select=requester_id&limit=1`,
      );
      if (!threads[0] || (!isAdmin && threads[0].requester_id !== viewerId)) return null;
      const internalClause = isAdmin ? '' : '&is_internal_note=eq.false';
      return await t.getJson<Record<string, unknown>[]>(
        `support_messages?thread_id=eq.${encodeURIComponent(threadId)}${internalClause}&order=created_at.asc`,
      );
    },

    async postSupportMessage(input) {
      const threads = await t.getJson<Array<{ requester_id: string }>>(
        `support_threads?id=eq.${encodeURIComponent(input.threadId)}&select=requester_id&limit=1`,
      );
      if (!threads[0] || (!input.isAdmin && threads[0].requester_id !== input.senderId)) return null;
      const rows = await t.sendJson<Record<string, unknown>[]>('POST', 'support_messages', {
        thread_id: input.threadId,
        sender_id: input.senderId,
        is_internal_note: false,
        body: input.body,
        attachment_public_ids: input.attachmentPublicIds,
      });
      return rows[0] ?? null;
    },

    async getOperatorVendor(profileId) {
      const owned = await t.getJson<Record<string, unknown>[]>(`vendors?owner_profile_id=eq.${encodeURIComponent(profileId)}&limit=1`);
      if (owned[0]) return { vendor: owned[0], operatorRole: 'owner' };
      const staff = await t.getJson<Array<{ vendor_id: string; role: 'manager' | 'kitchen_staff' }>>(
        `vendor_staff_members?profile_id=eq.${encodeURIComponent(profileId)}&is_active=eq.true&select=vendor_id,role&limit=1`,
      );
      if (!staff[0]) return null;
      const vRows = await t.getJson<Record<string, unknown>[]>(`vendors?id=eq.${encodeURIComponent(staff[0].vendor_id)}&limit=1`);
      return vRows[0] ? { vendor: vRows[0], operatorRole: staff[0].role } : null;
    },

    async updateOperatorVendor(vendorId, patch) {
      const rows = await t.sendJson<Record<string, unknown>[]>('PATCH', `vendors?id=eq.${encodeURIComponent(vendorId)}`, patch);
      return rows[0] ?? {};
    },

    async upsertMenuCategory(vendorId, categoryId, input) {
      const body = { vendor_id: vendorId, name_en: input.name_en, name_bn: input.name_bn, sort: input.sort, is_active: input.is_active };
      const rows = categoryId
        ? await t.sendJson<Record<string, unknown>[]>('PATCH', `menu_categories?id=eq.${encodeURIComponent(categoryId)}&vendor_id=eq.${encodeURIComponent(vendorId)}`, body)
        : await t.sendJson<Record<string, unknown>[]>('POST', 'menu_categories', body);
      return rows[0] ?? {};
    },

    async upsertMenuItem(vendorId, itemId, input) {
      const rows = itemId
        ? await t.sendJson<Record<string, unknown>[]>('PATCH', `menu_items?id=eq.${encodeURIComponent(itemId)}&vendor_id=eq.${encodeURIComponent(vendorId)}`, input)
        : await t.sendJson<Record<string, unknown>[]>('POST', 'menu_items', { vendor_id: vendorId, ...input });
      return rows[0] ?? {};
    },

    async submitVendorKycDoc(vendorId, docType, storagePath, expiresOn) {
      const rows = await t.sendJson<Record<string, unknown>[]>('POST', 'vendor_documents', {
        vendor_id: vendorId,
        doc_type: docType,
        storage_path: storagePath,
        expires_on: expiresOn,
      });
      return rows[0] ?? {};
    },

    async getVendorFinanceSummary(vendorId, includePayoutDetails) {
      const [invoices, ledger, payoutRows] = await Promise.all([
        t.getJson<Record<string, unknown>[]>(`invoices?payee_type=eq.vendor&payee_id=eq.${encodeURIComponent(vendorId)}&order=period_start.desc&limit=20`),
        t.getJson<Record<string, unknown>[]>(`ledger_entries?actor_type=eq.vendor&actor_id=eq.${encodeURIComponent(vendorId)}&order=created_at.desc&limit=50`),
        includePayoutDetails
          ? t.getJson<Record<string, unknown>[]>(`vendor_payout_accounts?vendor_id=eq.${encodeURIComponent(vendorId)}&is_primary=eq.true&select=method,holder_name,masked,is_primary&limit=1`)
          : Promise.resolve([] as Record<string, unknown>[]),
      ]);
      return { invoices, ledger, payout: includePayoutDetails ? (payoutRows[0] ?? null) : null };
    },

    async getRiderSelfProfile(profileId) {
      const [rRows, gate] = await Promise.all([
        t.getJson<Record<string, unknown>[]>(`riders?profile_id=eq.${encodeURIComponent(profileId)}&select=id,vehicle_type,date_of_birth,kyc_status,is_active,is_online,cash_gate_blocked,home_zone_id,payout_method,payout_holder_name,payout_masked,rating_avg,rating_count&limit=1`),
        this.getRiderCashGateByProfile(profileId),
      ]);
      return rRows[0] ? { rider: rRows[0], cash_gate: gate } : null;
    },

    async submitRiderKycDoc(profileId, docType, storagePath, expiresOn) {
      const rRows = await t.getJson<Array<{ id: string }>>(`riders?profile_id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`);
      if (!rRows[0]) throw new Error('RIDER_NOT_FOUND');
      const rows = await t.sendJson<Record<string, unknown>[]>('POST', 'rider_documents', {
        rider_id: rRows[0].id,
        doc_type: docType,
        storage_path: storagePath,
        expires_on: expiresOn,
      });
      return rows[0] ?? {};
    },

    async submitRiderRemittance(input) {
      const rRows = await t.getJson<Array<{ id: string }>>(`riders?profile_id=eq.${encodeURIComponent(input.profileId)}&select=id&limit=1`);
      if (!rRows[0]) throw new Error('RIDER_NOT_FOUND');
      return await t.callRpc<Record<string, unknown>>('submit_cash_remittance', {
        p_rider_id: rRows[0].id,
        p_method: input.method,
        p_amount_poisha: input.amountPoisha,
        p_bkash_trxid: input.bkashTrxid,
        p_sender_number: input.senderNumber,
        p_screenshot_public_id: input.screenshotPublicId,
        p_sender_name: input.senderName,
        p_selfie_public_id: input.selfiePublicId,
      });
    },

    async getRiderFinanceSummary(profileId) {
      const rRows = await t.getJson<Array<{ id: string }>>(`riders?profile_id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`);
      if (!rRows[0]) return null;
      const riderId = rRows[0].id;
      const [cashGate, remittances, invoices, ledger] = await Promise.all([
        this.getRiderCashGateByProfile(profileId),
        t.getJson<Record<string, unknown>[]>(`rider_cash_remittances?rider_id=eq.${encodeURIComponent(riderId)}&order=created_at.desc&limit=20`),
        t.getJson<Record<string, unknown>[]>(`invoices?payee_type=eq.rider&payee_id=eq.${encodeURIComponent(riderId)}&order=period_start.desc&limit=20`),
        t.getJson<Record<string, unknown>[]>(`ledger_entries?actor_type=eq.rider&actor_id=eq.${encodeURIComponent(riderId)}&order=created_at.desc&limit=50`),
      ]);
      return { cash_gate: cashGate, remittances, invoices, ledger };
    },
  };
}

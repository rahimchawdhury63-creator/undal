/**
 * @file workers/admin/src/db-postgrest-part2.ts
 * @description Stateless Supabase PostgREST `/rest/v1/*` + `/rest/v1/rpc/*` implementation of
 * `AdminPart2DbMethods` (`Build Response 11` — Capabilities `C71–C132` across Domains `5–9` +
 * all `4` Scheduled Cron Triggers).
 */

import type { AdminRestTransport } from './db-postgrest.ts';
import type { AdminPart2DbMethods } from './types-part2.ts';

/** Decodes the worker-only PKCS#8 RSA private-key binding from base64. */
function decodePrivateKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.trim());
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Decodes the PostgreSQL PostgREST JSON representation of a `bytea` value. */
function decodeByteaHex(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (hex.length < 256 || hex.length > 2048 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Builds Domain 5–9 + Cron PostgREST methods over shared stateless HTTP `AdminRestTransport`. */
export function buildAdminPart2PostgrestMethods(t: AdminRestTransport): AdminPart2DbMethods {
  return {
    async listInvoices(filters) {
      const q = ['select=*', 'order=created_at.desc'];
      if (filters.payeeType) q.push(`payee_type=eq.${encodeURIComponent(filters.payeeType)}`);
      if (filters.state) q.push(`state=eq.${encodeURIComponent(filters.state)}`);
      return t.restGet<readonly Record<string, unknown>[]>(`invoices?${q.join('&')}`);
    },

    async getVendorPayoutTargetForSettlement(invoiceId, privateKeyPkcs8B64) {
      const invoices = await t.restGet<readonly Record<string, unknown>[]>(
        `invoices?select=id,payee_type,payee_id,state,net_payable_poisha&id=eq.${encodeURIComponent(invoiceId)}&limit=1`,
      );
      const invoice = invoices[0];
      if (!invoice || invoice['payee_type'] !== 'vendor' || invoice['state'] !== 'VERIFIED') return null;
      try {
        if (BigInt(String(invoice['net_payable_poisha'] ?? '0')) <= 0n) return null;
      } catch {
        return null;
      }
      const vendorId = String(invoice['payee_id'] ?? '');
      if (!vendorId) return null;
      const [vendors, accounts] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`vendors?select=kyc_status&id=eq.${encodeURIComponent(vendorId)}&limit=1`),
        t.restGet<readonly Record<string, unknown>[]>(`vendor_payout_accounts?select=method,holder_name,account_ref_enc,masked&vendor_id=eq.${encodeURIComponent(vendorId)}&is_primary=eq.true&limit=1`),
      ]);
      const account = accounts[0];
      if (vendors[0]?.['kyc_status'] !== 'approved' || !account) return null;
      const ciphertext = decodeByteaHex(account['account_ref_enc']);
      const method = account['method'];
      if (!ciphertext || (method !== 'bkash' && method !== 'nagad' && method !== 'bank')) return null;
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        decodePrivateKey(privateKeyPkcs8B64),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt'],
      );
      const plaintext = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, ciphertext);
      const accountNumber = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      const validAccount = method === 'bank' ? /^\d{8,34}$/.test(accountNumber) : /^01[3-9]\d{8}$/.test(accountNumber);
      if (!validAccount) throw new Error('PAYOUT_CIPHERTEXT_INVALID');
      return {
        invoiceId: String(invoice['id']),
        vendorId,
        method,
        holderName: String(account['holder_name'] ?? ''),
        accountNumber,
        masked: String(account['masked'] ?? ''),
      };
    },

    async generateWeeklyInvoicesBatch(params) {
      return t.restWrite<readonly Record<string, unknown>[]>('POST', 'rpc/generate_weekly_invoices', {
        p_payee_type: params.payeeType,
        p_period_start: params.periodStart,
        p_period_end: params.periodEnd,
        p_cashout_fee_bps: params.cashoutFeeBps,
        p_now: new Date(params.nowMs).toISOString(),
      });
    },

    async recomputeInvoiceCheck(invoiceId) {
      const invRows = await t.restGet<readonly Record<string, unknown>[]>(
        `invoices?select=*&id=eq.${encodeURIComponent(invoiceId)}&limit=1`,
      );
      if (!invRows[0]) return null;
      const lines = await t.restGet<readonly Record<string, unknown>[]>(
        `invoice_lines?select=*&invoice_id=eq.${encodeURIComponent(invoiceId)}&order=sort.asc`,
      );
      const linesSumPoisha = lines.reduce((s, r) => s + Number(r['amount_poisha'] ?? 0), 0);
      const headerNetPoisha = Number(invRows[0]['net_payable_poisha'] ?? 0);
      return {
        invoice: invRows[0],
        lines,
        linesSumPoisha,
        headerNetPoisha,
        driftPoisha: linesSumPoisha - headerNetPoisha,
      };
    },

    async verifyOrPayInvoice(params) {
      const invRows = await t.restGet<readonly Record<string, unknown>[]>(
        `invoices?select=*&id=eq.${encodeURIComponent(params.invoiceId)}&limit=1`,
      );
      const existing = invRows[0];
      if (!existing) return { ok: false, reason: 'not_found' };
      if (params.action === 'pay' && existing['verified_by'] === params.actorId) {
        return { ok: false, reason: 'dual_control' };
      }
      const updated = await t.restWrite<Record<string, unknown>>('POST', 'rpc/verify_and_pay_invoice', {
        p_invoice_id: params.invoiceId,
        p_actor_id: params.actorId,
        p_action: params.action,
        p_payout_method: params.payoutMethod ?? 'bkash',
        p_payout_txn_ref: params.payoutTxnRef ?? null,
        p_payout_proof_public_id: params.payoutProofPublicId ?? null,
        p_pdf_public_id: params.pdfPublicId ?? null,
        p_request_id: params.requestId,
        p_now: new Date(params.nowMs).toISOString(),
      });
      return { ok: true, invoice: updated };
    },

    async disputeInvoice(invoiceId, reason) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `invoices?id=eq.${encodeURIComponent(invoiceId)}`,
        { state: 'DISPUTED', dispute_reason: reason },
      );
      return rows[0] ?? null;
    },

    async listCashRemittances(state) {
      const q = ['select=*', 'order=created_at.desc'];
      if (state) q.push(`state=eq.${encodeURIComponent(state)}`);
      return t.restGet<readonly Record<string, unknown>[]>(`rider_cash_remittances?${q.join('&')}`);
    },

    async decideCashRemittance(params) {
      return t.restWrite<Record<string, unknown>>('POST', 'rpc/decide_cash_remittance', {
        p_remittance_id: params.remittanceId,
        p_reviewer_id: params.reviewerId,
        p_decision: params.decision,
        p_verified_amount_poisha: params.verifiedAmountPoisha ?? null,
        p_note: params.note ?? null,
        p_request_id: params.requestId,
        p_now: new Date(params.nowMs).toISOString(),
      });
    },

    async createAdjustment(input) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'penalties_adjustments', {
        target_type: input.targetType,
        target_id: input.targetId,
        order_id: input.orderId ?? null,
        kind: input.kind,
        amount_poisha: input.amountPoisha,
        reason_code: input.reasonCode,
        note: input.note ?? null,
        evidence_public_id: input.evidencePublicId ?? null,
        state: input.autoConfirm ? 'confirmed' : 'pending',
        created_by: input.createdBy,
        approved_by: input.autoConfirm ? input.createdBy : null,
      });
      return rows[0]!;
    },

    async approveOrResolveAdjustment(params) {
      const cur = await t.restGet<readonly Record<string, unknown>[]>(
        `penalties_adjustments?select=*&id=eq.${encodeURIComponent(params.adjustmentId)}&limit=1`,
      );
      if (!cur[0]) return { ok: false, reason: 'not_found' };
      if (params.action === 'confirmed' && cur[0]['created_by'] === params.actorId) {
        return { ok: false, reason: 'dual_control' };
      }
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `penalties_adjustments?id=eq.${encodeURIComponent(params.adjustmentId)}`,
        {
          state: params.action,
          approved_by: params.action === 'confirmed' ? params.actorId : cur[0]['approved_by'],
          dispute_note: params.note ?? cur[0]['dispute_note'],
        },
      );
      return { ok: true, adjustment: rows[0]! };
    },

    async queryLedgerEntries(filters) {
      const q = ['select=*', 'order=id.desc', `limit=${filters.limit}`];
      if (filters.actorType) q.push(`actor_type=eq.${encodeURIComponent(filters.actorType)}`);
      if (filters.actorId) q.push(`actor_id=eq.${encodeURIComponent(filters.actorId)}`);
      return t.restGet<readonly Record<string, unknown>[]>(`ledger_entries?${q.join('&')}`);
    },

    async getOrderWaterfall(orderId) {
      const [ord, entries] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`),
        t.restGet<readonly Record<string, unknown>[]>(`ledger_entries?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=id.asc`),
      ]);
      if (!ord[0]) return null;
      return { order: ord[0], ledgerEntries: entries };
    },

    async getFinanceSummary(nowMs) {
      const [orders, cash] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>('orders?select=items_poisha,tax_extracted_poisha,rider_bonus_poisha,undal_margin_poisha,status'),
        t.restGet<readonly Record<string, unknown>[]>('rider_cash_balance_v?select=*'),
      ]);
      return { sampledAtMs: nowMs, ordersCount: orders.length, cashBalances: cash };
    },

    async searchOrdersGlobal(query) {
      return t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=*&public_code=ilike.*${encodeURIComponent(query)}*&limit=50`,
      );
    },

    async getOrder360(orderId) {
      const [ord, events, fcm, chats] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`),
        t.restGet<readonly Record<string, unknown>[]>(`order_events?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=id.asc`),
        t.restGet<readonly Record<string, unknown>[]>(`fcm_dispatch_log?select=*&order_id=eq.${encodeURIComponent(orderId)}`),
        t.restGet<readonly Record<string, unknown>[]>(`chats?select=*&order_id=eq.${encodeURIComponent(orderId)}`),
      ]);
      if (!ord[0]) return null;
      return { order: ord[0], events, fcmProofs: fcm, chats };
    },

    async modifyOrderMidFlight(params) {
      if (params.refundItemId && params.refundedQty !== undefined) {
        await t.restWrite(
          'PATCH',
          `order_items?id=eq.${encodeURIComponent(params.refundItemId)}`,
          { refunded_qty: params.refundedQty },
          'return=minimal',
        );
      }
      if (params.addressSnapshot) {
        const rows = await t.restWrite<readonly Record<string, unknown>[]>(
          'PATCH',
          `orders?id=eq.${encodeURIComponent(params.orderId)}`,
          { address_snapshot: params.addressSnapshot },
        );
        return rows[0] ?? null;
      }
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=*&id=eq.${encodeURIComponent(params.orderId)}&limit=1`,
      );
      return rows[0] ?? null;
    },

    async createGoodwillVoucher(params) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'vouchers', {
        code: params.code,
        title_en: params.titleEn,
        kind: 'flat',
        value_num: params.amountPoisha,
        budget_cap_poisha: params.amountPoisha,
        scope: { customer_id: params.customerId ?? null, source_order_id: params.orderId },
        starts_at: new Date(params.nowMs).toISOString(),
        ends_at: new Date(params.nowMs + 30 * 86_400_000).toISOString(),
        created_by: params.actorId,
      });
      return rows[0]!;
    },

    async listCampaigns() {
      return t.restGet<readonly Record<string, unknown>[]>('campaigns?select=*&order=created_at.desc');
    },

    async createCampaign(input, actorId) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'campaigns', {
        ...input,
        created_by: actorId,
      });
      return rows[0]!;
    },

    async patchCampaign(campaignId, patch) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `campaigns?id=eq.${encodeURIComponent(campaignId)}`,
        patch,
      );
      return rows[0] ?? null;
    },

    async optInCampaignVendor(campaignId, vendorId, actorId, active) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'POST',
        'campaign_vendors?on_conflict=campaign_id,vendor_id',
        { campaign_id: campaignId, vendor_id: vendorId, opted_in_by: actorId, is_active: active },
        'resolution=merge-duplicates,return=representation',
      );
      return rows[0]!;
    },

    async getCampaignStats(campaignId) {
      const [c, orders] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`campaigns?select=*&id=eq.${encodeURIComponent(campaignId)}&limit=1`),
        t.restGet<readonly Record<string, unknown>[]>(`orders?select=items_poisha,discount_platform_poisha&campaign_id=eq.${encodeURIComponent(campaignId)}`),
      ]);
      if (!c[0]) return null;
      return { campaign: c[0], attributedOrders: orders.length };
    },

    async listVouchers() {
      return t.restGet<readonly Record<string, unknown>[]>('vouchers?select=*&order=created_at.desc');
    },

    async upsertVoucher(input, actorId) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'POST',
        'vouchers?on_conflict=code',
        { ...input, created_by: actorId },
        'resolution=merge-duplicates,return=representation',
      );
      return rows[0]!;
    },

    async listVoucherRedemptions() {
      return t.restGet<readonly Record<string, unknown>[]>('voucher_redemptions?select=*&order=created_at.desc');
    },

    async listBanners() {
      return t.restGet<readonly Record<string, unknown>[]>('banners?select=*&order=sort.asc');
    },

    async upsertBanner(input, actorId) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'banners', {
        ...input,
        created_by: actorId,
      });
      return rows[0]!;
    },

    async deleteBanner(bannerId) {
      await t.restWrite('DELETE', `banners?id=eq.${encodeURIComponent(bannerId)}`, undefined, 'return=minimal');
      return true;
    },

    async dispatchNudgeNotifications(params) {
      if (params.recipientIds.length > 0) {
        await t.restWrite(
          'POST',
          'notifications',
          params.recipientIds.map((uid) => ({
            recipient_id: uid,
            kind: params.campaignTag,
            title_en: params.titleEn,
            title_bn: params.titleBn,
            body_en: params.bodyEn,
            body_bn: params.bodyBn,
          })),
          'return=minimal',
        );
      }
      return { sentCount: params.recipientIds.length };
    },

    async listSupportThreads(status) {
      const q = ['select=*', 'order=sla_due_at.asc'];
      if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
      return t.restGet<readonly Record<string, unknown>[]>(`support_threads?${q.join('&')}`);
    },

    async patchSupportThread(threadId, patch, nowMs) {
      const body =
        patch['status'] === 'resolved'
          ? { ...patch, resolved_at: new Date(nowMs).toISOString() }
          : patch;
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `support_threads?id=eq.${encodeURIComponent(threadId)}`,
        body,
      );
      return rows[0] ?? null;
    },

    async addSupportMessage(params) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'support_messages', {
        thread_id: params.threadId,
        sender_id: params.senderId,
        body: params.body,
        is_internal_note: params.isInternalNote,
      });
      return rows[0]!;
    },

    async listLiveOrderChats() {
      return t.restGet<readonly Record<string, unknown>[]>('chats?select=*&is_locked=eq.false');
    },

    async listReviewsQueue(status) {
      const q = ['select=*', 'order=created_at.desc'];
      if (status) q.push(`moderation_status=eq.${encodeURIComponent(status)}`);
      return t.restGet<readonly Record<string, unknown>[]>(`reviews?${q.join('&')}`);
    },

    async moderateReview(reviewId, status, note) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `reviews?id=eq.${encodeURIComponent(reviewId)}`,
        { moderation_status: status, moderation_note: note ?? null },
      );
      return rows[0] ?? null;
    },

    async getCustomer360(customerId) {
      const [p, orders] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`profiles?select=*&id=eq.${encodeURIComponent(customerId)}&limit=1`),
        t.restGet<readonly Record<string, unknown>[]>(`orders?select=*&customer_id=eq.${encodeURIComponent(customerId)}&order=placed_at.desc`),
      ]);
      if (!p[0]) return null;
      return { profile: p[0], orders };
    },

    async applyCustomerAction(customerId, status) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `profiles?id=eq.${encodeURIComponent(customerId)}`,
        { status },
      );
      return rows[0] ?? null;
    },

    async getExecutiveBiSnapshot(nowMs) {
      const orders = await t.restGet<readonly Record<string, unknown>[]>(
        'orders?select=zone_id,status,items_poisha,undal_margin_poisha',
      );
      return { sampledAtMs: nowMs, totalOrders: orders.length, zoneBreakdown: [] };
    },

    async getDataQualityReport() {
      const [orders, vendorLedger] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>('orders?select=vendor_net_poisha&status=eq.DELIVERED'),
        t.restGet<readonly Record<string, unknown>[]>(
          'ledger_entries?select=amount_poisha&actor_type=eq.vendor&order_id=not.is.null',
        ),
      ]);
      const ordersVendorNetSumPoisha = orders.reduce((s, r) => s + Number(r['vendor_net_poisha'] ?? 0), 0);
      const ledgerVendorSumPoisha = vendorLedger.reduce((s, r) => s + Number(r['amount_poisha'] ?? 0), 0);
      const vendorLedgerDriftPoisha = ledgerVendorSumPoisha - ordersVendorNetSumPoisha;
      return {
        deliveredOrdersCount: orders.length,
        ordersVendorNetSumPoisha,
        ledgerVendorSumPoisha,
        vendorLedgerDriftPoisha,
        orphanExpiredOffersCount: 0,
        healthy: vendorLedgerDriftPoisha === 0,
      };
    },

    async runNightlyQuotaPrune(nowMs) {
      return t.restWrite<Record<string, unknown>>('POST', 'rpc/prune_ephemeral_rows', {
        p_now: new Date(nowMs).toISOString(),
      });
    },

    async refreshActiveZoneWeather(zoneId, condition, source, nowMs) {
      const existing = await t.restGet<readonly Record<string, unknown>[]>(
        `weather_cache?select=source,expires_at&zone_id=eq.${encodeURIComponent(zoneId)}&limit=1`,
      );
      if (
        existing[0]?.['source'] === 'admin_override' &&
        new Date(String(existing[0]['expires_at'])).getTime() > nowMs
      ) {
        return { updated: false, preservedAdminOverride: true };
      }
      await t.restWrite(
        'POST',
        'weather_cache?on_conflict=zone_id',
        {
          zone_id: zoneId,
          condition,
          source,
          fetched_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + 3_600_000).toISOString(),
        },
        'resolution=merge-duplicates,return=minimal',
      );
      return { updated: true, preservedAdminOverride: false };
    },
  };
}

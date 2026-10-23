/**
 * @file workers/admin/test/_helpers/pglite-admin-harness-part2.mjs
 * @description Real PostgreSQL 16 (`PGlite` + `0001..0016` PL/pgSQL RPCs) Domain 5–9 + Cron
 * methods implementing `AdminPart2DbMethods` directly over live SQL tables & functions.
 */

/** Builds Domain 5–9 + Cron `AdminDbAdapter` methods backed by real PG16 tables & RPCs. */
export function buildPgliteAdminPart2Methods(db) {
  return {
    async listInvoices(filters) {
      const clauses = [];
      const vals = [];
      if (filters.payeeType) {
        vals.push(filters.payeeType);
        clauses.push(`payee_type = $${vals.length}`);
      }
      if (filters.state) {
        vals.push(filters.state);
        clauses.push(`state = $${vals.length}`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      return (await db.query(`SELECT * FROM public.invoices ${where} ORDER BY created_at DESC`, vals)).rows;
    },

    async generateWeeklyInvoicesBatch(params) {
      return (
        await db.query('SELECT * FROM public.generate_weekly_invoices($1, $2::date, $3::date, $4::int, $5::timestamptz)', [
          params.payeeType,
          params.periodStart,
          params.periodEnd,
          params.cashoutFeeBps,
          new Date(params.nowMs).toISOString(),
        ])
      ).rows;
    },

    async recomputeInvoiceCheck(invoiceId) {
      const inv = (await db.query('SELECT * FROM public.invoices WHERE id = $1 LIMIT 1', [invoiceId])).rows[0];
      if (!inv) return null;
      const lines = (
        await db.query('SELECT * FROM public.invoice_lines WHERE invoice_id = $1 ORDER BY sort ASC', [invoiceId])
      ).rows;
      const linesSumPoisha = lines.reduce((s, r) => s + Number(r.amount_poisha), 0);
      const headerNetPoisha = Number(inv.net_payable_poisha);
      return {
        invoice: inv,
        lines,
        linesSumPoisha,
        headerNetPoisha,
        driftPoisha: linesSumPoisha - headerNetPoisha,
      };
    },

    async verifyOrPayInvoice(params) {
      const existing = (await db.query('SELECT * FROM public.invoices WHERE id = $1 LIMIT 1', [params.invoiceId])).rows[0];
      if (!existing) return { ok: false, reason: 'not_found' };
      if (params.action === 'pay' && existing.verified_by === params.actorId) {
        return { ok: false, reason: 'dual_control' };
      }
      const row = (
        await db.query(
          'SELECT * FROM public.verify_and_pay_invoice($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)',
          [
            params.invoiceId,
            params.actorId,
            params.action,
            params.payoutMethod ?? 'bkash',
            params.payoutTxnRef ?? null,
            params.payoutProofPublicId ?? null,
            params.pdfPublicId ?? null,
            params.requestId,
            new Date(params.nowMs).toISOString(),
          ],
        )
      ).rows[0];
      return { ok: true, invoice: row };
    },

    async disputeInvoice(invoiceId, reason) {
      return (
        await db.query(
          `UPDATE public.invoices SET state = 'DISPUTED', dispute_reason = $2 WHERE id = $1 RETURNING *`,
          [invoiceId, reason],
        )
      ).rows[0] ?? null;
    },

    async listCashRemittances(state) {
      if (state) {
        return (await db.query('SELECT * FROM public.rider_cash_remittances WHERE state = $1 ORDER BY created_at DESC', [state])).rows;
      }
      return (await db.query('SELECT * FROM public.rider_cash_remittances ORDER BY created_at DESC')).rows;
    },

    async decideCashRemittance(params) {
      const r = (
        await db.query(
          'SELECT public.decide_cash_remittance($1, $2, $3, $4, $5, $6, $7::timestamptz) AS res',
          [
            params.remittanceId,
            params.reviewerId,
            params.decision,
            params.verifiedAmountPoisha ?? null,
            params.note ?? null,
            params.requestId,
            new Date(params.nowMs).toISOString(),
          ],
        )
      ).rows[0];
      return r?.res ?? null;
    },

    async createAdjustment(input) {
      return (
        await db.query(
          `INSERT INTO public.penalties_adjustments (
             target_type, target_id, order_id, kind, amount_poisha, reason_code, note,
             evidence_public_id, state, created_by, approved_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            input.targetType,
            input.targetId,
            input.orderId ?? null,
            input.kind,
            input.amountPoisha,
            input.reasonCode,
            input.note ?? null,
            input.evidencePublicId ?? null,
            input.autoConfirm ? 'confirmed' : 'pending',
            input.createdBy,
            input.autoConfirm ? input.createdBy : null,
          ],
        )
      ).rows[0];
    },

    async approveOrResolveAdjustment(params) {
      const cur = (await db.query('SELECT * FROM public.penalties_adjustments WHERE id = $1 LIMIT 1', [params.adjustmentId])).rows[0];
      if (!cur) return { ok: false, reason: 'not_found' };
      if (params.action === 'confirmed' && cur.created_by === params.actorId) {
        return { ok: false, reason: 'dual_control' };
      }
      const row = (
        await db.query(
          `UPDATE public.penalties_adjustments
           SET state = $2,
               approved_by = CASE WHEN $2 = 'confirmed' THEN $3::uuid ELSE approved_by END,
               dispute_note = coalesce($4, dispute_note)
           WHERE id = $1 RETURNING *`,
          [params.adjustmentId, params.action, params.actorId, params.note ?? null],
        )
      ).rows[0];
      return { ok: true, adjustment: row };
    },

    async queryLedgerEntries(filters) {
      const clauses = [];
      const vals = [];
      if (filters.actorType) {
        vals.push(filters.actorType);
        clauses.push(`actor_type = $${vals.length}`);
      }
      if (filters.actorId) {
        vals.push(filters.actorId);
        clauses.push(`actor_id = $${vals.length}`);
      }
      vals.push(filters.limit);
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      return (await db.query(`SELECT * FROM public.ledger_entries ${where} ORDER BY id DESC LIMIT $${vals.length}`, vals)).rows;
    },

    async getOrderWaterfall(orderId) {
      const ord = (await db.query('SELECT * FROM public.orders WHERE id = $1 LIMIT 1', [orderId])).rows[0];
      if (!ord) return null;
      const entries = (await db.query('SELECT * FROM public.ledger_entries WHERE order_id = $1 ORDER BY id ASC', [orderId])).rows;
      return { order: ord, ledgerEntries: entries };
    },

    async getFinanceSummary(nowMs) {
      const totals = (
        await db.query(
          `SELECT
             count(*)::int AS orders_count,
             coalesce(sum(items_poisha), 0)::bigint AS gmv_poisha,
             coalesce(sum(tax_extracted_poisha), 0)::bigint AS vat_extracted_poisha,
             coalesce(sum(rider_bonus_poisha), 0)::bigint AS rider_bonus_pool_poisha,
             coalesce(sum(undal_margin_poisha), 0)::bigint AS undal_margin_poisha
           FROM public.orders WHERE status = 'DELIVERED'`,
        )
      ).rows[0];
      const cash = (await db.query('SELECT * FROM public.rider_cash_balance_v')).rows;
      return { sampledAtMs: nowMs, ...totals, cashBalances: cash };
    },

    async searchOrdersGlobal(query) {
      return (
        await db.query(
          `SELECT o.* FROM public.orders o
           JOIN public.profiles p ON p.id = o.customer_id
           WHERE o.public_code ILIKE $1 OR p.phone ILIKE $1 OR p.full_name ILIKE $1
           ORDER BY o.placed_at DESC LIMIT 50`,
          [`%${query}%`],
        )
      ).rows;
    },

    async getOrder360(orderId) {
      const ord = (await db.query('SELECT * FROM public.orders WHERE id = $1 LIMIT 1', [orderId])).rows[0];
      if (!ord) return null;
      const events = (await db.query('SELECT * FROM public.order_events WHERE order_id = $1 ORDER BY id ASC', [orderId])).rows;
      const fcm = (await db.query('SELECT * FROM public.fcm_dispatch_log WHERE order_id = $1 ORDER BY id ASC', [orderId])).rows;
      const chats = (await db.query('SELECT * FROM public.chats WHERE order_id = $1', [orderId])).rows;
      return { order: ord, events, fcmProofs: fcm, chats };
    },

    async modifyOrderMidFlight(params) {
      if (params.refundItemId && params.refundedQty !== undefined) {
        await db.query('UPDATE public.order_items SET refunded_qty = $2 WHERE id = $1', [
          params.refundItemId,
          params.refundedQty,
        ]);
      }
      if (params.addressSnapshot) {
        return (
          await db.query('UPDATE public.orders SET address_snapshot = $2::jsonb WHERE id = $1 RETURNING *', [
            params.orderId,
            JSON.stringify(params.addressSnapshot),
          ])
        ).rows[0] ?? null;
      }
      return (await db.query('SELECT * FROM public.orders WHERE id = $1 LIMIT 1', [params.orderId])).rows[0] ?? null;
    },

    async createGoodwillVoucher(params) {
      return (
        await db.query(
          `INSERT INTO public.vouchers (
             code, title_en, kind, value_num, budget_cap_poisha, scope, starts_at, ends_at, created_by
           ) VALUES ($1, $2, 'flat', $3, $3, $4::jsonb, $5, $6, $7) RETURNING *`,
          [
            params.code,
            params.titleEn,
            params.amountPoisha,
            JSON.stringify({ customer_id: params.customerId ?? null, source_order_id: params.orderId }),
            new Date(params.nowMs).toISOString(),
            new Date(params.nowMs + 30 * 86_400_000).toISOString(),
            params.actorId,
          ],
        )
      ).rows[0];
    },

    async listCampaigns() {
      return (await db.query('SELECT * FROM public.campaigns ORDER BY created_at DESC')).rows;
    },

    async createCampaign(input, actorId) {
      return (
        await db.query(
          `INSERT INTO public.campaigns (
             slug, kind, title_en, title_bn, percent_bps, flat_poisha, cap_poisha,
             min_order_poisha, vendor_share_bps, budget_cap_poisha, daily_start_time, daily_end_time,
             starts_at, ends_at, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            input.slug,
            input.kind,
            input.title_en,
            input.title_bn,
            input.percent_bps ?? null,
            input.flat_poisha ?? null,
            input.cap_poisha ?? null,
            input.min_order_poisha ?? 0,
            input.vendor_share_bps ?? 5000,
            input.budget_cap_poisha ?? null,
            input.daily_start_time ?? null,
            input.daily_end_time ?? null,
            input.starts_at,
            input.ends_at,
            actorId,
          ],
        )
      ).rows[0];
    },

    async patchCampaign(campaignId, patch) {
      return (
        await db.query(
          `UPDATE public.campaigns SET
             budget_cap_poisha = coalesce($2, budget_cap_poisha),
             is_active = coalesce($3, is_active),
             daily_start_time = coalesce($4, daily_start_time),
             daily_end_time = coalesce($5, daily_end_time)
           WHERE id = $1 RETURNING *`,
          [
            campaignId,
            patch.budget_cap_poisha ?? null,
            patch.is_active ?? null,
            patch.daily_start_time ?? null,
            patch.daily_end_time ?? null,
          ],
        )
      ).rows[0] ?? null;
    },

    async optInCampaignVendor(campaignId, vendorId, actorId, active) {
      return (
        await db.query(
          `INSERT INTO public.campaign_vendors (campaign_id, vendor_id, opted_in_by, is_active)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (campaign_id, vendor_id) DO UPDATE SET is_active = EXCLUDED.is_active
           RETURNING *`,
          [campaignId, vendorId, actorId, active],
        )
      ).rows[0];
    },

    async getCampaignStats(campaignId) {
      const c = (await db.query('SELECT * FROM public.campaigns WHERE id = $1 LIMIT 1', [campaignId])).rows[0];
      if (!c) return null;
      const o = (await db.query('SELECT count(*)::int AS cnt FROM public.orders WHERE campaign_id = $1', [campaignId])).rows[0];
      return { campaign: c, attributedOrders: Number(o.cnt) };
    },

    async listVouchers() {
      return (await db.query('SELECT * FROM public.vouchers ORDER BY created_at DESC')).rows;
    },

    async upsertVoucher(input, actorId) {
      return (
        await db.query(
          `INSERT INTO public.vouchers (
             code, title_en, title_bn, kind, value_num, cap_poisha, min_order_poisha,
             vendor_share_bps, budget_cap_poisha, starts_at, ends_at, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (code) DO UPDATE SET is_active = coalesce($13, public.vouchers.is_active)
           RETURNING *`,
          [
            input.code,
            input.title_en,
            input.title_bn ?? null,
            input.kind,
            input.value_num,
            input.cap_poisha ?? null,
            input.min_order_poisha ?? 0,
            input.vendor_share_bps ?? 0,
            input.budget_cap_poisha ?? 100_000,
            input.starts_at,
            input.ends_at,
            actorId,
            input.is_active ?? true,
          ],
        )
      ).rows[0];
    },

    async listVoucherRedemptions() {
      return (await db.query('SELECT * FROM public.voucher_redemptions ORDER BY created_at DESC')).rows;
    },

    async listBanners() {
      return (await db.query('SELECT * FROM public.banners ORDER BY sort ASC')).rows;
    },

    async upsertBanner(input, actorId) {
      return (
        await db.query(
          `INSERT INTO public.banners (zone_id, title_en, title_bn, image_url, deep_link, placement, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            input.zone_id ?? null,
            input.title_en,
            input.title_bn ?? null,
            input.image_url,
            input.deep_link ?? '/flash-box',
            input.placement ?? 'home_hero',
            actorId,
          ],
        )
      ).rows[0];
    },

    async deleteBanner(bannerId) {
      await db.query('DELETE FROM public.banners WHERE id = $1', [bannerId]);
      return true;
    },

    async dispatchNudgeNotifications(params) {
      for (const uid of params.recipientIds) {
        await db.query(
          `INSERT INTO public.notifications (recipient_id, kind, title_en, title_bn, body_en, body_bn)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [uid, params.campaignTag, params.titleEn, params.titleBn, params.bodyEn, params.bodyBn],
        );
      }
      return { sentCount: params.recipientIds.length };
    },

    async listSupportThreads(status) {
      if (status) {
        return (await db.query('SELECT * FROM public.support_threads WHERE status = $1 ORDER BY sla_due_at ASC', [status])).rows;
      }
      return (await db.query('SELECT * FROM public.support_threads ORDER BY sla_due_at ASC')).rows;
    },

    async patchSupportThread(threadId, patch, nowMs) {
      return (
        await db.query(
          `UPDATE public.support_threads SET
             status = coalesce($2, status),
             priority = coalesce($3, priority),
             assigned_admin_id = coalesce($4, assigned_admin_id),
             resolved_at = CASE WHEN $2 = 'resolved' THEN $5::timestamptz ELSE resolved_at END
           WHERE id = $1 RETURNING *`,
          [threadId, patch.status ?? null, patch.priority ?? null, patch.assigned_admin_id ?? null, new Date(nowMs).toISOString()],
        )
      ).rows[0] ?? null;
    },

    async addSupportMessage(params) {
      return (
        await db.query(
          `INSERT INTO public.support_messages (thread_id, sender_id, is_internal_note, body)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [params.threadId, params.senderId, params.isInternalNote, params.body],
        )
      ).rows[0];
    },

    async listLiveOrderChats() {
      return (await db.query('SELECT * FROM public.chats WHERE is_locked = false')).rows;
    },

    async listReviewsQueue(status) {
      if (status) {
        return (await db.query('SELECT * FROM public.reviews WHERE moderation_status = $1 ORDER BY created_at DESC', [status])).rows;
      }
      return (await db.query('SELECT * FROM public.reviews ORDER BY created_at DESC')).rows;
    },

    async moderateReview(reviewId, status, note) {
      return (
        await db.query(
          'UPDATE public.reviews SET moderation_status = $2, moderation_note = $3 WHERE id = $1 RETURNING *',
          [reviewId, status, note ?? null],
        )
      ).rows[0] ?? null;
    },

    async getCustomer360(customerId) {
      const p = (await db.query('SELECT * FROM public.profiles WHERE id = $1 LIMIT 1', [customerId])).rows[0];
      if (!p) return null;
      const orders = (await db.query('SELECT * FROM public.orders WHERE customer_id = $1 ORDER BY placed_at DESC', [customerId])).rows;
      return { profile: p, orders };
    },

    async applyCustomerAction(customerId, status) {
      return (await db.query('UPDATE public.profiles SET status = $2 WHERE id = $1 RETURNING *', [customerId, status])).rows[0] ?? null;
    },
  };
}

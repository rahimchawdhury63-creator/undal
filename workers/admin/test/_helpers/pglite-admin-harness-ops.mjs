/**
 * @file workers/admin/test/_helpers/pglite-admin-harness-ops.mjs
 * @description Real PostgreSQL 16 (`PGlite`) Domain 2 (Dispatch/Logistics `C22–C40`) &
 * Domain 4 (3-Track KYC, Vendor 360, Menu Moderation & Catalog `C55–C70`) methods for `AdminDbAdapter`.
 */

/** Builds Domain 2 + Domain 4 `AdminDbAdapter` methods backed by live PG16 queries. */
export function buildPgliteAdminOpsMethods(db) {
  return {
    async getDispatchMapSnapshot(nowMs) {
      const presence = (await db.query('SELECT * FROM public.presence_live')).rows;
      const activeOrders = (
        await db.query(
          `SELECT id, public_code, vendor_id, rider_id, zone_id, status, placed_at FROM public.orders
           WHERE status NOT IN ('DELIVERED','CANCELLED_CUSTOMER','CANCELLED_VENDOR','CANCELLED_ADMIN','CANCELLED_TIMEOUT')`,
        )
      ).rows;
      const zones = (await db.query('SELECT id, slug, name_en, is_active FROM public.zones')).rows;
      return { sampledAtMs: nowMs, presence, activeOrders, zones };
    },

    async getDispatchEntityDetail(kind, id) {
      const table = kind === 'rider' ? 'riders' : kind === 'vendor' ? 'vendors' : 'orders';
      return (await db.query(`SELECT * FROM public.${table} WHERE id = $1 LIMIT 1`, [id])).rows[0] ?? null;
    },

    async listDispatchBoard(exceptionsOnly, nowMs) {
      const rows = (
        await db.query(
          `SELECT * FROM public.orders
           WHERE status NOT IN ('DELIVERED','CANCELLED_CUSTOMER','CANCELLED_VENDOR','CANCELLED_ADMIN','CANCELLED_TIMEOUT')
           ORDER BY placed_at ASC`,
        )
      ).rows;
      if (!exceptionsOnly) return rows;
      return rows.filter((r) => {
        const ageMs = nowMs - new Date(r.placed_at).getTime();
        return (r.status === 'PLACED' && ageMs > 180_000) || (!r.rider_id && ageMs > 180_000);
      });
    },

    async assignRiderToOrder(orderId, riderId, calculatedFarePoisha) {
      const before = (await db.query('SELECT * FROM public.orders WHERE id = $1 LIMIT 1', [orderId])).rows[0];
      if (!before) return null;
      const after = (
        await db.query(
          `UPDATE public.orders
           SET rider_id = $2, status = 'RIDER_ASSIGNED',
               rider_fare_poisha = coalesce($3, rider_fare_poisha)
           WHERE id = $1 RETURNING *`,
          [orderId, riderId, calculatedFarePoisha],
        )
      ).rows[0];
      return { before, after };
    },

    async unassignRiderFromOrder(orderId) {
      return (
        await db.query(
          `UPDATE public.orders SET rider_id = NULL, batch_id = NULL, status = 'READY_FOR_PICKUP' WHERE id = $1 RETURNING *`,
          [orderId],
        )
      ).rows[0] ?? null;
    },

    async adminCancelOrder(orderId, reasonKey, nowMs) {
      return (
        await db.query(
          `UPDATE public.orders SET status = 'CANCELLED_ADMIN', cancel_reason_key = $2, cancelled_at = $3 WHERE id = $1 RETURNING *`,
          [orderId, reasonKey, new Date(nowMs).toISOString()],
        )
      ).rows[0] ?? null;
    },

    async adminForceCompleteOrder(orderId, actorId, evidencePublicId, note, nowMs) {
      const cur = (await db.query('SELECT status FROM public.orders WHERE id = $1 LIMIT 1', [orderId])).rows[0];
      if (!cur) return null;
      if (cur.status === 'PLACED') {
        await db.query(`UPDATE public.orders SET status = 'VENDOR_ACCEPTED' WHERE id = $1`, [orderId]);
      }
      if (!['READY_FOR_PICKUP', 'PICKED_UP', 'RIDER_AT_CUSTOMER'].includes(cur.status)) {
        await db.query(`UPDATE public.orders SET status = 'READY_FOR_PICKUP' WHERE id = $1`, [orderId]);
      }
      const after = (
        await db.query(
          `UPDATE public.orders SET status = 'DELIVERED', delivered_at = $2 WHERE id = $1 RETURNING *`,
          [orderId, new Date(nowMs).toISOString()],
        )
      ).rows[0];
      await db.query(
        `INSERT INTO public.order_events (order_id, actor_id, actor_kind, from_status, to_status, meta)
         VALUES ($1, $2, 'admin', $3, 'DELIVERED', $4::jsonb)`,
        [orderId, actorId, cur.status, JSON.stringify({ evidence_public_id: evidencePublicId, note })],
      );
      return after;
    },

    async updateOrderEta(orderId, extraPrepMinutes) {
      return (
        await db.query(
          `UPDATE public.orders SET prep_minutes_committed = prep_minutes_committed + $2 WHERE id = $1 RETURNING *`,
          [orderId, extraPrepMinutes],
        )
      ).rows[0] ?? null;
    },

    async listFleetRiders() {
      return (await db.query('SELECT * FROM public.riders ORDER BY updated_at DESC')).rows;
    },

    async listFleetCashBalances() {
      return (await db.query('SELECT * FROM public.rider_cash_balance_v')).rows;
    },

    async forceEndRiderSession(riderId, nowMs) {
      await db.query('UPDATE public.riders SET is_online = false WHERE id = $1', [riderId]);
      await db.query(
        `UPDATE public.rider_shifts SET ended_at = $2, end_reason = 'admin' WHERE rider_id = $1 AND ended_at IS NULL`,
        [riderId, new Date(nowMs).toISOString()],
      );
      return true;
    },

    async listActiveBatches() {
      return (await db.query(`SELECT * FROM public.order_batches WHERE state IN ('offered', 'active')`)).rows;
    },

    async breakOrderBatch(batchId) {
      await db.query('UPDATE public.orders SET batch_id = NULL WHERE batch_id = $1', [batchId]);
      return (await db.query(`UPDATE public.order_batches SET state = 'broken' WHERE id = $1 RETURNING *`, [batchId])).rows[0] ?? null;
    },

    async listSlaBreaches(nowMs) {
      return (
        await db.query(
          `SELECT id, public_code, status, placed_at, vendor_id, rider_id FROM public.orders
           WHERE status = 'PLACED' AND placed_at < $1`,
          [new Date(nowMs - 180_000).toISOString()],
        )
      ).rows;
    },

    async getOrderOffersTrace(orderId) {
      return (await db.query('SELECT * FROM public.order_offers WHERE order_id = $1 ORDER BY offered_at ASC', [orderId])).rows;
    },

    async getKycQueue() {
      const vendors = (await db.query(`SELECT * FROM public.vendors WHERE kyc_status IN ('submitted','under_review','needs_fix')`)).rows;
      const riders = (await db.query(`SELECT * FROM public.riders WHERE kyc_status IN ('submitted','under_review','needs_fix')`)).rows;
      return { vendors, riders };
    },

    async getMediaAssetByPublicId(publicId) {
      const r = (await db.query('SELECT * FROM public.media_assets WHERE cloudinary_public_id = $1 LIMIT 1', [publicId])).rows[0];
      if (!r) return null;
      return {
        id: String(r.id),
        provider: r.provider,
        category: String(r.category),
        deliveryType: r.delivery_type,
        resourceType: r.resource_type,
        format: r.format ? String(r.format) : null,
      };
    },

    async decideKycApplication(params) {
      if (params.documentDecisions) {
        const docTable = params.targetType === 'vendor' ? 'vendor_documents' : 'rider_documents';
        for (const d of params.documentDecisions) {
          await db.query(
            `UPDATE public.${docTable} SET review_status = $2, reviewer_id = $3, review_note = $4 WHERE id = $1`,
            [d.docId, d.status, params.reviewerId, d.note ?? null],
          );
        }
      }
      const table = params.targetType === 'vendor' ? 'vendors' : 'riders';
      return (
        await db.query(
          `UPDATE public.${table} SET kyc_status = $2, is_active = $3 WHERE id = $1 RETURNING *`,
          [params.targetId, params.decision, params.decision === 'approved'],
        )
      ).rows[0] ?? null;
    },

    async listExpiringDocuments(withinDays, nowMs) {
      const horizon = new Date(nowMs + withinDays * 86_400_000).toISOString().slice(0, 10);
      const vDocs = (await db.query('SELECT * FROM public.vendor_documents WHERE expires_on <= $1', [horizon])).rows;
      const rDocs = (await db.query('SELECT * FROM public.rider_documents WHERE expires_on <= $1', [horizon])).rows;
      return [...vDocs.map((d) => ({ kind: 'vendor', ...d })), ...rDocs.map((d) => ({ kind: 'rider', ...d }))];
    },

    async getVendor360(vendorId) {
      return (await db.query('SELECT * FROM public.vendors WHERE id = $1 LIMIT 1', [vendorId])).rows[0] ?? null;
    },

    async patchVendor360(vendorId, patch) {
      const before = (await db.query('SELECT * FROM public.vendors WHERE id = $1 LIMIT 1', [vendorId])).rows[0];
      if (!before) return null;
      const after = (
        await db.query(
          `UPDATE public.vendors SET
             commission_bps = coalesce($2, commission_bps),
             min_order_poisha = coalesce($3, min_order_poisha),
             hygiene_verified = coalesce($4, hygiene_verified)
           WHERE id = $1 RETURNING *`,
          [vendorId, patch.commission_bps ?? null, patch.min_order_poisha ?? null, patch.hygiene_verified ?? null],
        )
      ).rows[0];
      return { before, after };
    },

    async getVendorRankingBreakdown(vendorId) {
      const v = (await db.query('SELECT * FROM public.vendors WHERE id = $1 LIMIT 1', [vendorId])).rows[0];
      if (!v) return null;
      return {
        vendorId,
        ratingAvg: Number(v.rating_avg),
        ratingCount: Number(v.rating_count),
        prepReliability: Number(v.prep_reliability),
        acceptanceRate: Number(v.acceptance_rate),
        ontimeHandoverRate: Number(v.ontime_handover_rate),
        complaintFreeRate: Number(v.complaint_free_rate),
        hygieneVerified: Boolean(v.hygiene_verified),
      };
    },

    async getVendorFinanceTab(vendorId) {
      const invoices = (await db.query(`SELECT * FROM public.invoices WHERE payee_type = 'vendor' AND payee_id = $1`, [vendorId])).rows;
      const ledger = (await db.query(`SELECT * FROM public.ledger_entries WHERE actor_type = 'vendor' AND actor_id = $1`, [vendorId])).rows;
      return { invoices, ledger };
    },

    async getVendorReviewsTab(vendorId) {
      const reviews = (await db.query('SELECT * FROM public.reviews WHERE vendor_id = $1 ORDER BY created_at DESC', [vendorId])).rows;
      return { reviews };
    },

    async createVendorEmergencyPause(vendorId, minutes, reason, actorId, nowMs) {
      return (
        await db.query(
          `INSERT INTO public.vendor_pauses (vendor_id, starts_at, ends_at, reason, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [vendorId, new Date(nowMs).toISOString(), new Date(nowMs + minutes * 60_000).toISOString(), reason, actorId],
        )
      ).rows[0];
    },

    async setVendorSuspension(vendorId, suspended) {
      return (await db.query('UPDATE public.vendors SET is_active = $2 WHERE id = $1 RETURNING *', [vendorId, !suspended])).rows[0] ?? null;
    },

    async listMenuModerationQueue() {
      const items = (await db.query('SELECT * FROM public.menu_items ORDER BY created_at DESC')).rows;
      const dupes = (
        await db.query(
          `SELECT vendor_id, lower(btrim(name_en)) AS norm_title, count(*)::int AS copies
           FROM public.menu_items GROUP BY vendor_id, lower(btrim(name_en)) HAVING count(*) > 1`,
        )
      ).rows;
      return { items, duplicateTitleSpam: dupes };
    },

    async moderateMenuItem(itemId, action) {
      return (
        await db.query(
          'UPDATE public.menu_items SET is_available = $2, moderation_status = $3 WHERE id = $1 RETURNING *',
          [itemId, action === 'approve', action === 'approve' ? 'visible' : 'hidden'],
        )
      ).rows[0] ?? null;
    },

    async listMenuPriceAlerts() {
      return (
        await db.query(
          `SELECT id, vendor_id, name_en, price_poisha, compare_at_poisha FROM public.menu_items
           WHERE compare_at_poisha IS NOT NULL AND compare_at_poisha > price_poisha * 1.4`,
        )
      ).rows;
    },

    async listTaxonomy() {
      return (await db.query('SELECT * FROM public.cuisine_taxonomy ORDER BY sort ASC, key ASC')).rows;
    },

    async upsertTaxonomyItem(input) {
      return (
        await db.query(
          `INSERT INTO public.cuisine_taxonomy (key, name_en, name_bn, parent_key, synonyms, sort, is_active)
           VALUES ($1, $2, $3, $4, $5::text[], $6, $7)
           ON CONFLICT (key) DO UPDATE SET
             name_en = EXCLUDED.name_en, name_bn = EXCLUDED.name_bn,
             synonyms = EXCLUDED.synonyms, sort = EXCLUDED.sort, is_active = EXCLUDED.is_active
           RETURNING *`,
          [input.key, input.nameEn, input.nameBn, input.parentKey ?? null, input.synonyms, input.sort, input.isActive],
        )
      ).rows[0];
    },

    async searchCatalogItems(query) {
      return (
        await db.query('SELECT * FROM public.menu_items WHERE name_en ILIKE $1 LIMIT 50', [`%${query}%`])
      ).rows;
    },

    async getExecutiveBiSnapshot(nowMs) {
      const zones = (
        await db.query(
          `SELECT z.slug, count(o.id)::int AS orders_count,
                  coalesce(sum(o.items_poisha), 0)::bigint AS gmv_poisha,
                  coalesce(sum(o.undal_margin_poisha), 0)::bigint AS margin_poisha
           FROM public.zones z
           LEFT JOIN public.orders o ON o.zone_id = z.id AND o.status = 'DELIVERED'
           GROUP BY z.slug ORDER BY z.slug ASC`,
        )
      ).rows;
      return { sampledAtMs: nowMs, zoneBreakdown: zones };
    },

    async getDataQualityReport() {
      const ordRow = (
        await db.query(
          `SELECT count(*)::int AS cnt, coalesce(sum(vendor_net_poisha), 0)::bigint AS sum_net
           FROM public.orders WHERE status = 'DELIVERED'`,
        )
      ).rows[0];
      const ledRow = (
        await db.query(
          `SELECT coalesce(sum(amount_poisha), 0)::bigint AS sum_led
           FROM public.ledger_entries WHERE actor_type = 'vendor' AND order_id IS NOT NULL`,
        )
      ).rows[0];
      const ordersVendorNetSumPoisha = Number(ordRow.sum_net);
      const ledgerVendorSumPoisha = Number(ledRow.sum_led);
      const vendorLedgerDriftPoisha = ledgerVendorSumPoisha - ordersVendorNetSumPoisha;
      return {
        deliveredOrdersCount: Number(ordRow.cnt),
        ordersVendorNetSumPoisha,
        ledgerVendorSumPoisha,
        vendorLedgerDriftPoisha,
        orphanExpiredOffersCount: 0,
        healthy: vendorLedgerDriftPoisha === 0,
      };
    },

    async runNightlyQuotaPrune(nowMs) {
      const r = (await db.query('SELECT public.prune_ephemeral_rows($1::timestamptz) AS res', [new Date(nowMs).toISOString()])).rows[0];
      return r.res;
    },

    async refreshActiveZoneWeather(zoneId, condition, source, nowMs) {
      const existing = (await db.query('SELECT * FROM public.weather_cache WHERE zone_id = $1 LIMIT 1', [zoneId])).rows[0];
      if (existing?.source === 'admin_override' && new Date(existing.expires_at).getTime() > nowMs) {
        return { updated: false, preservedAdminOverride: true };
      }
      await db.query(
        `INSERT INTO public.weather_cache (zone_id, condition, source, fetched_at, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (zone_id) DO UPDATE SET
           condition = EXCLUDED.condition, source = EXCLUDED.source,
           fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
        [zoneId, condition, source, new Date(nowMs).toISOString(), new Date(nowMs + 3_600_000).toISOString()],
      );
      return { updated: true, preservedAdminOverride: false };
    },
  };
}

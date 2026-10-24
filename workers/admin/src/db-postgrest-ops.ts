/**
 * @file workers/admin/src/db-postgrest-ops.ts
 * @description Production Supabase PostgREST (`/rest/v1/*`) adapter — Part B:
 * **Domain 2 (`C22–C40` Live Dispatch, Interventions, Fleet, Batches & SLA)** &
 * **Domain 4 (`C55–C70` 3-Track KYC Pipeline, Private Media Lookup, Vendor 360, Moderation & Taxonomy)**.
 */

import type { AdminRestTransport } from './db-postgrest.ts';
import type { AdminDbAdapter } from './types.ts';

type OpsSubset = Pick<
  AdminDbAdapter,
  | 'getDispatchMapSnapshot'
  | 'getDispatchEntityDetail'
  | 'listDispatchBoard'
  | 'assignRiderToOrder'
  | 'unassignRiderFromOrder'
  | 'adminCancelOrder'
  | 'adminForceCompleteOrder'
  | 'updateOrderEta'
  | 'listFleetRiders'
  | 'listFleetCashBalances'
  | 'forceEndRiderSession'
  | 'listActiveBatches'
  | 'breakOrderBatch'
  | 'listSlaBreaches'
  | 'getOrderOffersTrace'
  | 'getKycQueue'
  | 'getMediaAssetByPublicId'
  | 'decideKycApplication'
  | 'listExpiringDocuments'
  | 'getVendor360'
  | 'patchVendor360'
  | 'getVendorRankingBreakdown'
  | 'getVendorFinanceTab'
  | 'getVendorReviewsTab'
  | 'createVendorEmergencyPause'
  | 'setVendorSuspension'
  | 'listMenuModerationQueue'
  | 'moderateMenuItem'
  | 'listMenuPriceAlerts'
  | 'listTaxonomy'
  | 'upsertTaxonomyItem'
  | 'searchCatalogItems'
>;

export function createPostgrestAdminOps(t: AdminRestTransport): OpsSubset {
  return {
    async getDispatchMapSnapshot(nowMs) {
      const [presence, orders, zones] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>('presence_live?select=*'),
        t.restGet<readonly Record<string, unknown>[]>(
          'orders?select=id,public_code,vendor_id,rider_id,zone_id,status,placed_at&status=not.in.(DELIVERED,PICKED_UP_CUSTOMER,CANCELLED_CUSTOMER,CANCELLED_VENDOR,CANCELLED_RIDER,CANCELLED_ADMIN,CANCELLED_TIMEOUT)',
        ),
        t.restGet<readonly Record<string, unknown>[]>('zones?select=id,slug,name_en,is_active'),
      ]);
      return { sampledAtMs: nowMs, presence, activeOrders: orders, zones };
    },

    async getDispatchEntityDetail(kind, id) {
      const table = kind === 'rider' ? 'riders' : kind === 'vendor' ? 'vendors' : 'orders';
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `${table}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
      );
      return rows[0] ?? null;
    },

    async listDispatchBoard(exceptionsOnly, nowMs) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        'orders?select=*&status=not.in.(DELIVERED,PICKED_UP_CUSTOMER,CANCELLED_CUSTOMER,CANCELLED_VENDOR,CANCELLED_RIDER,CANCELLED_ADMIN,CANCELLED_TIMEOUT)&order=placed_at.asc',
      );
      if (!exceptionsOnly) return rows;
      return rows.filter((r) => {
        const ageMs = nowMs - new Date(String(r['placed_at'])).getTime();
        return (r['status'] === 'PLACED' && ageMs > 180_000) || (!r['rider_id'] && ageMs > 180_000);
      });
    },

    async assignRiderToOrder(orderId, riderId, calculatedFarePoisha) {
      const beforeRows = await t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`,
      );
      if (!beforeRows[0]) return null;
      const patch: Record<string, unknown> = {
        rider_id: riderId,
        status: 'RIDER_ASSIGNED',
        ...(calculatedFarePoisha !== null ? { rider_fare_poisha: calculatedFarePoisha } : {}),
      };
      const afterRows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `orders?id=eq.${encodeURIComponent(orderId)}`,
        patch,
      );
      return { before: beforeRows[0], after: afterRows[0] ?? patch };
    },

    async unassignRiderFromOrder(orderId) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `orders?id=eq.${encodeURIComponent(orderId)}`,
        { rider_id: null, batch_id: null, status: 'READY_FOR_PICKUP' },
      );
      return rows[0] ?? null;
    },

    async adminCancelOrder(orderId, reasonKey, nowMs) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `orders?id=eq.${encodeURIComponent(orderId)}`,
        {
          status: 'CANCELLED_ADMIN',
          cancel_reason_key: reasonKey,
          cancelled_at: new Date(nowMs).toISOString(),
        },
      );
      return rows[0] ?? null;
    },

    async adminForceCompleteOrder(orderId, actorId, evidencePublicId, note, nowMs) {
      const cur = await t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
      );
      if (!cur[0]) return null;
      const fromStatus = String(cur[0]['status'] ?? 'READY_FOR_PICKUP');
      if (fromStatus === 'PLACED') {
        await t.restWrite('PATCH', `orders?id=eq.${encodeURIComponent(orderId)}`, { status: 'VENDOR_ACCEPTED' }, 'return=minimal');
      }
      if (!['READY_FOR_PICKUP', 'PICKED_UP', 'RIDER_AT_CUSTOMER'].includes(fromStatus)) {
        await t.restWrite('PATCH', `orders?id=eq.${encodeURIComponent(orderId)}`, { status: 'READY_FOR_PICKUP' }, 'return=minimal');
      }
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `orders?id=eq.${encodeURIComponent(orderId)}`,
        { status: 'DELIVERED', delivered_at: new Date(nowMs).toISOString() },
      );
      if (!rows[0]) return null;
      await t.restWrite(
        'POST',
        'order_events',
        {
          order_id: orderId,
          actor_id: actorId,
          actor_kind: 'admin',
          from_status: fromStatus,
          to_status: 'DELIVERED',
          meta: { evidence_public_id: evidencePublicId, note },
        },
        'return=minimal',
      );
      return rows[0];
    },

    async updateOrderEta(orderId, extraPrepMinutes) {
      const cur = await t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=prep_minutes_committed&id=eq.${encodeURIComponent(orderId)}&limit=1`,
      );
      if (!cur[0]) return null;
      const next = Number(cur[0]['prep_minutes_committed'] ?? 15) + extraPrepMinutes;
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `orders?id=eq.${encodeURIComponent(orderId)}`,
        { prep_minutes_committed: next },
      );
      return rows[0] ?? null;
    },

    async listFleetRiders() {
      return t.restGet<readonly Record<string, unknown>[]>('riders?select=*&order=updated_at.desc');
    },

    async listFleetCashBalances() {
      return t.restGet<readonly Record<string, unknown>[]>('rider_cash_balance_v?select=*');
    },

    async forceEndRiderSession(riderId, nowMs) {
      await t.restWrite(
        'PATCH',
        `riders?id=eq.${encodeURIComponent(riderId)}`,
        { is_online: false },
        'return=minimal',
      );
      await t.restWrite(
        'PATCH',
        `rider_shifts?rider_id=eq.${encodeURIComponent(riderId)}&ended_at=is.null`,
        { ended_at: new Date(nowMs).toISOString(), end_reason: 'admin' },
        'return=minimal',
      );
      return true;
    },

    async listActiveBatches() {
      return t.restGet<readonly Record<string, unknown>[]>('order_batches?select=*&state=in.(offered,active)');
    },

    async breakOrderBatch(batchId) {
      await t.restWrite('PATCH', `orders?batch_id=eq.${encodeURIComponent(batchId)}`, { batch_id: null }, 'return=minimal');
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `order_batches?id=eq.${encodeURIComponent(batchId)}`,
        { state: 'broken' },
      );
      return rows[0] ?? null;
    },

    async listSlaBreaches(nowMs) {
      const cutoffIso = new Date(nowMs - 180_000).toISOString();
      return t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=id,public_code,status,placed_at,vendor_id,rider_id&status=eq.PLACED&placed_at=lt.${encodeURIComponent(cutoffIso)}`,
      );
    },

    async getOrderOffersTrace(orderId) {
      return t.restGet<readonly Record<string, unknown>[]>(
        `order_offers?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=offered_at.asc`,
      );
    },

    async getKycQueue() {
      const [vendors, riders] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>('vendors?select=*&kyc_status=in.(submitted,under_review,needs_fix)'),
        t.restGet<readonly Record<string, unknown>[]>('riders?select=*&kyc_status=in.(submitted,under_review,needs_fix)'),
      ]);
      return { vendors, riders };
    },

    async getMediaAssetByPublicId(publicId) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `media_assets?select=*&cloudinary_public_id=eq.${encodeURIComponent(publicId)}&limit=1`,
      );
      const r = rows[0];
      if (!r) return null;
      return {
        id: String(r['id']),
        provider: r['provider'] as 'imgbb' | 'cloudinary',
        category: String(r['category']),
        deliveryType: r['delivery_type'] as 'upload' | 'authenticated' | 'private',
        resourceType: r['resource_type'] as 'image' | 'raw' | 'video',
        format: r['format'] ? String(r['format']) : null,
      };
    },

    async decideKycApplication(params) {
      if (params.documentDecisions) {
        const docTable = params.targetType === 'vendor' ? 'vendor_documents' : 'rider_documents';
        for (const d of params.documentDecisions) {
          await t.restWrite(
            'PATCH',
            `${docTable}?id=eq.${encodeURIComponent(d.docId)}`,
            { review_status: d.status, reviewer_id: params.reviewerId, review_note: d.note ?? null },
            'return=minimal',
          );
        }
      }
      const table = params.targetType === 'vendor' ? 'vendors' : 'riders';
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `${table}?id=eq.${encodeURIComponent(params.targetId)}`,
        { kyc_status: params.decision, is_active: params.decision === 'approved' },
      );
      const decided = rows[0];
      if (!decided) return null;
      let ownerRolePromoted = false;
      if (params.targetType === 'vendor' && params.decision === 'approved' && typeof decided['owner_profile_id'] === 'string') {
        const ownerProfileId = encodeURIComponent(decided['owner_profile_id']);
        const upgraded = await t.restWrite<readonly Record<string, unknown>[]>(
          'PATCH',
          `profiles?id=eq.${ownerProfileId}&role=eq.customer&status=eq.active`,
          { role: 'vendor_owner' },
        );
        ownerRolePromoted = upgraded.some((profile) => profile['role'] === 'vendor_owner');
      }
      return { ...decided, owner_role_promoted: ownerRolePromoted };
    },

    async listExpiringDocuments(withinDays, nowMs) {
      const horizon = new Date(nowMs + withinDays * 86_400_000).toISOString().slice(0, 10);
      const [vDocs, rDocs] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`vendor_documents?select=*&expires_on=lte.${horizon}`),
        t.restGet<readonly Record<string, unknown>[]>(`rider_documents?select=*&expires_on=lte.${horizon}`),
      ]);
      return [...vDocs.map((d) => ({ kind: 'vendor', ...d })), ...rDocs.map((d) => ({ kind: 'rider', ...d }))];
    },

    async getVendor360(vendorId) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `vendors?select=*&id=eq.${encodeURIComponent(vendorId)}&limit=1`,
      );
      return rows[0] ?? null;
    },

    async patchVendor360(vendorId, patch) {
      const beforeRows = await t.restGet<readonly Record<string, unknown>[]>(
        `vendors?select=*&id=eq.${encodeURIComponent(vendorId)}&limit=1`,
      );
      if (!beforeRows[0]) return null;
      const afterRows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `vendors?id=eq.${encodeURIComponent(vendorId)}`,
        patch,
      );
      return { before: beforeRows[0], after: afterRows[0] ?? patch };
    },

    async getVendorRankingBreakdown(vendorId) {
      const v = await this.getVendor360(vendorId);
      if (!v) return null;
      return {
        vendorId,
        ratingAvg: Number(v['rating_avg'] ?? 0),
        ratingCount: Number(v['rating_count'] ?? 0),
        prepReliability: Number(v['prep_reliability'] ?? 100),
        acceptanceRate: Number(v['acceptance_rate'] ?? 100),
        ontimeHandoverRate: Number(v['ontime_handover_rate'] ?? 100),
        complaintFreeRate: Number(v['complaint_free_rate'] ?? 100),
        hygieneVerified: Boolean(v['hygiene_verified']),
      };
    },

    async getVendorFinanceTab(vendorId) {
      const [invoices, ledger] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`invoices?select=*&payee_type=eq.vendor&payee_id=eq.${encodeURIComponent(vendorId)}`),
        t.restGet<readonly Record<string, unknown>[]>(`ledger_entries?select=*&actor_type=eq.vendor&actor_id=eq.${encodeURIComponent(vendorId)}&limit=100`),
      ]);
      return { invoices, ledger };
    },

    async getVendorReviewsTab(vendorId) {
      const reviews = await t.restGet<readonly Record<string, unknown>[]>(
        `reviews?select=*&vendor_id=eq.${encodeURIComponent(vendorId)}&order=created_at.desc&limit=50`,
      );
      return { reviews };
    },

    async createVendorEmergencyPause(vendorId, minutes, reason, actorId, nowMs) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'vendor_pauses', {
        vendor_id: vendorId,
        starts_at: new Date(nowMs).toISOString(),
        ends_at: new Date(nowMs + minutes * 60_000).toISOString(),
        reason,
        created_by: actorId,
      });
      return rows[0]!;
    },

    async setVendorSuspension(vendorId, suspended) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `vendors?id=eq.${encodeURIComponent(vendorId)}`,
        { is_active: !suspended },
      );
      return rows[0] ?? null;
    },

    async listMenuModerationQueue() {
      const items = await t.restGet<readonly Record<string, unknown>[]>('menu_items?select=*&is_available=eq.true');
      return { items };
    },

    async moderateMenuItem(itemId, action) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `menu_items?id=eq.${encodeURIComponent(itemId)}`,
        {
          is_available: action === 'approve',
          moderation_status: action === 'approve' ? 'visible' : 'hidden',
        },
      );
      return rows[0] ?? null;
    },

    async listMenuPriceAlerts() {
      const items = await t.restGet<readonly Record<string, unknown>[]>(
        'menu_items?select=id,vendor_id,name_en,price_poisha,compare_at_poisha&compare_at_poisha=not.is.null',
      );
      return items.filter(
        (m) => Number(m['compare_at_poisha'] ?? 0) > Number(m['price_poisha'] ?? 0) * 1.4,
      );
    },

    async listTaxonomy() {
      return t.restGet<readonly Record<string, unknown>[]>('cuisine_taxonomy?select=*&order=sort.asc');
    },

    async upsertTaxonomyItem(input) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'POST',
        'cuisine_taxonomy?on_conflict=key',
        {
          key: input.key,
          name_en: input.nameEn,
          name_bn: input.nameBn,
          parent_key: input.parentKey ?? null,
          synonyms: input.synonyms,
          sort: input.sort,
          is_active: input.isActive,
        },
        'resolution=merge-duplicates,return=representation',
      );
      return rows[0]!;
    },

    async searchCatalogItems(query) {
      return t.restGet<readonly Record<string, unknown>[]>(
        `menu_items?select=*&name_en=ilike.*${encodeURIComponent(query)}*&limit=50`,
      );
    },
  };
}

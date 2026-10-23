/**
 * @file workers/admin/src/types-part2.ts
 * @description Typed repository contracts for `W3 undal-admin` Part 2 (`Build Response 11` —
 * Capabilities `C71–C132` across Domains `5–9` + all `4` `wrangler.toml` Cron Triggers).
 */

/** Domain 5–9 + Cron persistence methods implemented by both PostgREST & real PG16 `PGlite`. */
export interface AdminPart2DbMethods {
  // --- Domain 5: Finance, Weekly Settlement, Cash Gate, Adjustments & Reports (`C71–C89`) ---
  listInvoices(filters: {
    readonly payeeType?: 'vendor' | 'rider' | undefined;
    readonly state?: string | undefined;
  }): Promise<readonly Record<string, unknown>[]>;
  generateWeeklyInvoicesBatch(params: {
    readonly payeeType: 'vendor' | 'rider';
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly cashoutFeeBps: number;
    readonly nowMs: number;
  }): Promise<readonly Record<string, unknown>[]>;
  recomputeInvoiceCheck(invoiceId: string): Promise<{
    readonly invoice: Record<string, unknown>;
    readonly lines: readonly Record<string, unknown>[];
    readonly linesSumPoisha: number;
    readonly headerNetPoisha: number;
    readonly driftPoisha: number;
  } | null>;
  verifyOrPayInvoice(params: {
    readonly invoiceId: string;
    readonly actorId: string;
    readonly action: 'verify' | 'pay';
    readonly payoutMethod?: 'bkash' | 'nagad' | 'bank' | undefined;
    readonly payoutTxnRef?: string | undefined;
    readonly payoutProofPublicId?: string | undefined;
    readonly pdfPublicId?: string | undefined;
    readonly requestId: string;
    readonly nowMs: number;
  }): Promise<
    | { readonly ok: true; readonly invoice: Record<string, unknown> }
    | { readonly ok: false; readonly reason: 'not_found' | 'dual_control' | 'invalid_state' }
  >;
  disputeInvoice(invoiceId: string, reason: string): Promise<Record<string, unknown> | null>;
  listCashRemittances(state?: string | undefined): Promise<readonly Record<string, unknown>[]>;
  decideCashRemittance(params: {
    readonly remittanceId: string;
    readonly reviewerId: string;
    readonly decision: 'verified' | 'partial' | 'rejected';
    readonly verifiedAmountPoisha?: number | undefined;
    readonly note?: string | undefined;
    readonly requestId: string;
    readonly nowMs: number;
  }): Promise<Record<string, unknown> | null>;
  createAdjustment(input: {
    readonly targetType: 'vendor' | 'rider';
    readonly targetId: string;
    readonly orderId?: string | undefined;
    readonly kind: 'penalty' | 'bonus' | 'refund_adjustment';
    readonly amountPoisha: number;
    readonly reasonCode: string;
    readonly note?: string | undefined;
    readonly evidencePublicId?: string | undefined;
    readonly autoConfirm: boolean;
    readonly createdBy: string;
  }): Promise<Record<string, unknown>>;
  approveOrResolveAdjustment(params: {
    readonly adjustmentId: string;
    readonly actorId: string;
    readonly action: 'confirmed' | 'cancelled' | 'disputed';
    readonly note?: string | undefined;
  }): Promise<
    | { readonly ok: true; readonly adjustment: Record<string, unknown> }
    | { readonly ok: false; readonly reason: 'not_found' | 'dual_control' }
  >;
  queryLedgerEntries(filters: {
    readonly actorType?: string | undefined;
    readonly actorId?: string | undefined;
    readonly limit: number;
  }): Promise<readonly Record<string, unknown>[]>;
  getOrderWaterfall(orderId: string): Promise<Record<string, unknown> | null>;
  getFinanceSummary(nowMs: number): Promise<Record<string, unknown>>;

  // --- Domain 6: Order 360, Exceptions, Mid-Order Modify & Search (`C90–C101`) ---
  searchOrdersGlobal(query: string): Promise<readonly Record<string, unknown>[]>;
  getOrder360(orderId: string): Promise<Record<string, unknown> | null>;
  modifyOrderMidFlight(params: {
    readonly orderId: string;
    readonly addressSnapshot?: Record<string, unknown> | undefined;
    readonly refundItemId?: string | undefined;
    readonly refundedQty?: number | undefined;
  }): Promise<Record<string, unknown> | null>;
  createGoodwillVoucher(params: {
    readonly code: string;
    readonly titleEn: string;
    readonly amountPoisha: number;
    readonly customerId?: string | undefined;
    readonly orderId: string;
    readonly actorId: string;
    readonly nowMs: number;
  }): Promise<Record<string, unknown>>;

  // --- Domain 7: Zero-Ads Growth Engine (`C102–C113`) ---
  listCampaigns(): Promise<readonly Record<string, unknown>[]>;
  createCampaign(input: Record<string, unknown>, actorId: string): Promise<Record<string, unknown>>;
  patchCampaign(campaignId: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  optInCampaignVendor(campaignId: string, vendorId: string, actorId: string, active: boolean): Promise<Record<string, unknown>>;
  getCampaignStats(campaignId: string): Promise<Record<string, unknown> | null>;
  listVouchers(): Promise<readonly Record<string, unknown>[]>;
  upsertVoucher(input: Record<string, unknown>, actorId: string): Promise<Record<string, unknown>>;
  listVoucherRedemptions(): Promise<readonly Record<string, unknown>[]>;
  listBanners(): Promise<readonly Record<string, unknown>[]>;
  upsertBanner(input: Record<string, unknown>, actorId: string): Promise<Record<string, unknown>>;
  deleteBanner(bannerId: string): Promise<boolean>;
  dispatchNudgeNotifications(params: {
    readonly recipientIds: readonly string[];
    readonly titleEn: string;
    readonly titleBn: string;
    readonly bodyEn: string;
    readonly bodyBn: string;
    readonly campaignTag: string;
  }): Promise<{ readonly sentCount: number }>;

  // --- Domain 8: Unified Support, Live Chats, Disputes, Reviews & Customer 360 (`C114–C124`) ---
  listSupportThreads(status?: string | undefined): Promise<readonly Record<string, unknown>[]>;
  patchSupportThread(threadId: string, patch: Record<string, unknown>, nowMs: number): Promise<Record<string, unknown> | null>;
  addSupportMessage(params: {
    readonly threadId: string;
    readonly senderId: string;
    readonly body: string;
    readonly isInternalNote: boolean;
  }): Promise<Record<string, unknown>>;
  listLiveOrderChats(): Promise<readonly Record<string, unknown>[]>;
  listReviewsQueue(status?: string | undefined): Promise<readonly Record<string, unknown>[]>;
  moderateReview(reviewId: string, status: 'visible' | 'hidden', note?: string | undefined): Promise<Record<string, unknown> | null>;
  getCustomer360(customerId: string): Promise<Record<string, unknown> | null>;
  applyCustomerAction(
    customerId: string,
    status: 'active' | 'suspended',
  ): Promise<Record<string, unknown> | null>;

  // --- Domain 9 & Scheduled Crons: Executive BI & Zero-Drift Quality (`C125–C132`) ---
  getExecutiveBiSnapshot(nowMs: number): Promise<Record<string, unknown>>;
  getDataQualityReport(): Promise<{
    readonly deliveredOrdersCount: number;
    readonly ordersVendorNetSumPoisha: number;
    readonly ledgerVendorSumPoisha: number;
    readonly vendorLedgerDriftPoisha: number;
    readonly orphanExpiredOffersCount: number;
    readonly healthy: boolean;
  }>;
  runNightlyQuotaPrune(nowMs: number): Promise<Record<string, unknown>>;
  refreshActiveZoneWeather(
    zoneId: string,
    condition: 'clear' | 'rain' | 'storm' | 'extreme_heat',
    source: string,
    nowMs: number,
  ): Promise<{ readonly updated: boolean; readonly preservedAdminOverride: boolean }>;
}

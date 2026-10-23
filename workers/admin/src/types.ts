/**
 * @file workers/admin/src/types.ts
 * @description Domain & repository contracts for `W3 undal-admin` (`Build Response 10` —
 * Capabilities `C1..C70` across Domains `1–4`: Governance & Security, Live Dispatch & Fleet,
 * Geofencing & Dynamic Fare Engine, and 3-Track Vendor/Rider KYC & Menu Moderation).
 */

import type { FarePolicyConfig } from '@undal/shared-ts';
import type { LngLatPair } from './geo-polygon.ts';
import type { AdminPart2DbMethods } from './types-part2.ts';

export interface AdminPrincipal {
  readonly profileId: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: 'active' | 'suspended' | 'deleted';
  readonly totpEnrolledAtMs: number | null;
  readonly roleKeys: readonly string[];
  readonly permissions: readonly string[];
  readonly sessionId: string;
}

export interface AuditWriteInput {
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly diff: Record<string, unknown>;
  readonly reason?: string | undefined;
  readonly ip?: string | undefined;
  readonly requestId: string;
  readonly nowMs: number;
}

export interface AdminDbAdapter extends AdminPart2DbMethods {
  // --- Auth, Admin Users, Roles & Sessions (`C1–C9`) ---
  getAdminPrincipal(profileId: string): Promise<Omit<AdminPrincipal, 'sessionId'> | null>;
  enrollAdminTotp(profileId: string, nowMs: number): Promise<void>;
  listAdminUsers(): Promise<readonly Record<string, unknown>[]>;
  upsertAdminUser(input: {
    readonly profileId?: string | undefined;
    readonly email: string;
    readonly fullName: string;
    readonly phone?: string | undefined;
    readonly status: 'active' | 'suspended';
    readonly nowMs: number;
  }): Promise<Record<string, unknown>>;
  setAdminUserRoles(profileId: string, roleKeys: readonly string[], grantedBy: string): Promise<readonly string[]>;
  resetAdminUserTotp(profileId: string): Promise<void>;
  listAdminRoles(): Promise<readonly {
    readonly id: string;
    readonly key: string;
    readonly nameEn: string;
    readonly nameBn: string;
    readonly isSystem: boolean;
    readonly permissions: readonly string[];
    readonly assignedCount: number;
  }[]>;
  createAdminRole(input: {
    readonly key: string;
    readonly nameEn: string;
    readonly nameBn: string;
    readonly descriptionEn?: string | undefined;
    readonly permissions: readonly string[];
  }): Promise<{ readonly id: string; readonly key: string; readonly permissions: readonly string[] }>;
  setRolePermissions(roleId: string, permissions: readonly string[]): Promise<readonly string[]>;

  // --- Audit Logs, Settings, Kill Switches, Health & Client Errors (`C10–C21`) ---
  appendAuditLog(entry: AuditWriteInput): Promise<number>;
  queryAuditLogs(filters: {
    readonly actorId?: string | undefined;
    readonly action?: string | undefined;
    readonly entityType?: string | undefined;
    readonly limit: number;
  }): Promise<readonly Record<string, unknown>[]>;
  getAuditLogById(id: number): Promise<Record<string, unknown> | null>;
  listPlatformSettings(groupKey?: string): Promise<readonly Record<string, unknown>[]>;
  updatePlatformSettings(updates: Readonly<Record<string, unknown>>, actorId: string): Promise<{
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  }>;
  rollbackPlatformSetting(key: string, targetVersion: number | undefined, actorId: string): Promise<{
    readonly key: string;
    readonly previousValue: unknown;
    readonly restoredValue: unknown;
    readonly newVersion: number;
  } | null>;
  getSystemQuotaSnapshot(nowMs: number): Promise<Record<string, unknown>>;
  listClientErrors(statusFilter?: string): Promise<readonly Record<string, unknown>[]>;
  triageClientError(errorId: number, status: 'open' | 'resolved' | 'ignored', note: string | undefined, actorId: string): Promise<Record<string, unknown> | null>;

  // --- Domain 2: Live Dispatch, Interventions, Fleet, Batches & SLA (`C22–C40`) ---
  getDispatchMapSnapshot(nowMs: number): Promise<Record<string, unknown>>;
  getDispatchEntityDetail(kind: 'rider' | 'vendor' | 'order', id: string): Promise<Record<string, unknown> | null>;
  listDispatchBoard(exceptionsOnly: boolean, nowMs: number): Promise<readonly Record<string, unknown>[]>;
  assignRiderToOrder(orderId: string, riderId: string, calculatedFarePoisha: number | null, mode: 'assign' | 'reassign'): Promise<{
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  } | null>;
  unassignRiderFromOrder(orderId: string): Promise<Record<string, unknown> | null>;
  adminCancelOrder(orderId: string, reasonKey: string, nowMs: number): Promise<Record<string, unknown> | null>;
  adminForceCompleteOrder(orderId: string, actorId: string, evidencePublicId: string, note: string, nowMs: number): Promise<Record<string, unknown> | null>;
  updateOrderEta(orderId: string, extraPrepMinutes: number): Promise<Record<string, unknown> | null>;
  listFleetRiders(nowMs: number): Promise<readonly Record<string, unknown>[]>;
  listFleetCashBalances(): Promise<readonly Record<string, unknown>[]>;
  forceEndRiderSession(riderId: string, nowMs: number): Promise<boolean>;
  listActiveBatches(): Promise<readonly Record<string, unknown>[]>;
  breakOrderBatch(batchId: string): Promise<Record<string, unknown> | null>;
  listSlaBreaches(nowMs: number): Promise<readonly Record<string, unknown>[]>;
  getOrderOffersTrace(orderId: string): Promise<readonly Record<string, unknown>[]>;

  // --- Domain 3: Zones, Delivery Fees & Dynamic Fare Config (`C41–C54`) ---
  listZonesAdmin(): Promise<readonly {
    readonly id: string;
    readonly nameEn: string;
    readonly nameBn: string;
    readonly slug: string;
    readonly polygon: readonly LngLatPair[];
    readonly areaKm2: number;
    readonly centerLat: number;
    readonly centerLng: number;
    readonly roadFactor: number;
    readonly isActive: boolean;
    readonly feeOverrides: Record<string, unknown>;
    readonly config: Record<string, unknown>;
  }[]>;
  createZoneAdmin(input: {
    readonly nameEn: string;
    readonly nameBn: string;
    readonly slug: string;
    readonly polygon: readonly LngLatPair[];
    readonly roadFactor: number;
    readonly isActive: boolean;
    readonly feeOverrides: Record<string, unknown>;
    readonly config: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  updateZoneAdmin(zoneId: string, patch: Record<string, unknown>): Promise<{
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  } | null>;
  setZoneWeatherOverride(zoneId: string, condition: 'clear' | 'extreme_heat' | 'rain' | 'storm', ttlMinutes: number, nowMs: number): Promise<Record<string, unknown>>;
  getFarePolicyConfig(): Promise<FarePolicyConfig>;

  // --- Domain 4: KYC Pipeline, Private Media Signed View, Vendor 360, Moderation & Catalog (`C55–C70`) ---
  getKycQueue(): Promise<Record<string, unknown>>;
  getMediaAssetByPublicId(publicId: string): Promise<{
    readonly id: string;
    readonly provider: 'imgbb' | 'cloudinary';
    readonly category: string;
    readonly deliveryType: 'upload' | 'authenticated' | 'private';
    readonly resourceType: 'image' | 'raw' | 'video';
    readonly format: string | null;
  } | null>;
  decideKycApplication(params: {
    readonly targetType: 'vendor' | 'rider';
    readonly targetId: string;
    readonly decision: 'approved' | 'needs_fix' | 'rejected';
    readonly documentDecisions?: readonly { readonly docId: string; readonly status: 'approved' | 'needs_fix' | 'rejected'; readonly note?: string }[] | undefined;
    readonly note?: string | undefined;
    readonly reviewerId: string;
  }): Promise<Record<string, unknown> | null>;
  listExpiringDocuments(withinDays: number, nowMs: number): Promise<readonly Record<string, unknown>[]>;
  getVendor360(vendorId: string): Promise<Record<string, unknown> | null>;
  patchVendor360(vendorId: string, patch: Record<string, unknown>): Promise<{
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  } | null>;
  getVendorRankingBreakdown(vendorId: string): Promise<Record<string, unknown> | null>;
  getVendorFinanceTab(vendorId: string): Promise<Record<string, unknown>>;
  getVendorReviewsTab(vendorId: string): Promise<Record<string, unknown>>;
  createVendorEmergencyPause(vendorId: string, minutes: number, reason: string, actorId: string, nowMs: number): Promise<Record<string, unknown>>;
  setVendorSuspension(vendorId: string, suspended: boolean): Promise<Record<string, unknown> | null>;
  listMenuModerationQueue(): Promise<Record<string, unknown>>;
  moderateMenuItem(itemId: string, action: 'hide' | 'approve' | 'flag_photo', note?: string): Promise<Record<string, unknown> | null>;
  listMenuPriceAlerts(): Promise<readonly Record<string, unknown>[]>;
  listTaxonomy(): Promise<readonly Record<string, unknown>[]>;
  upsertTaxonomyItem(input: {
    readonly key: string;
    readonly nameEn: string;
    readonly nameBn: string;
    readonly parentKey?: string | null | undefined;
    readonly synonyms: readonly string[];
    readonly sort: number;
    readonly isActive: boolean;
  }): Promise<Record<string, unknown>>;
  searchCatalogItems(query: string): Promise<readonly Record<string, unknown>[]>;
}

export interface AdminWorkerEnv {
  readonly SERVICE_NAME?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SUPABASE_JWT_SECRET?: string;
  readonly ADMIN_TOTP_PEPPER?: string;
  readonly UNDAL_CLOUDINARY_CLOUD_NAME?: string;
  readonly CLOUDINARY_API_SECRET?: string;
  readonly dbAdapter?: AdminDbAdapter;
  readonly nowMs?: () => number;
}

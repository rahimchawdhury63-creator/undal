/**
 * @file workers/api/src/types.ts
 * @description Shared types, environment bindings, and pluggable PostgreSQL/PostgREST repository contract
 * for `W1 undal-api` (`Build Response 6`).
 */

import type {
  PublicImgbbCategory,
  SensitiveCloudinaryCategory,
} from '@undal/shared-ts';

export type UserRole = 'customer' | 'vendor_owner' | 'vendor_staff' | 'rider' | 'admin';

export interface AuthPrincipal {
  readonly sub: string;
  readonly role: UserRole;
  readonly status: 'active' | 'suspended' | 'deleted';
  readonly email: string | null;
  readonly phone: string | null;
}

export interface StoredMediaAssetRow {
  readonly id: string;
  readonly owner_profile_id: string;
  readonly provider: 'imgbb' | 'cloudinary';
  readonly category: PublicImgbbCategory | SensitiveCloudinaryCategory;
  readonly delivery_type: 'upload' | 'authenticated' | 'private';
  readonly cloudinary_public_id: string;
  readonly public_cdn_url: string | null;
  readonly medium_url: string | null;
  readonly thumb_url: string | null;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly format: string | null;
}

export interface ApiDbAdapter {
  ping(): Promise<boolean>;
  getProfileAuthState(userId: string): Promise<AuthPrincipal | null>;
  getPublicSettings(): Promise<Record<string, unknown>>;
  resolveZone(lat: number, lng: number): Promise<Record<string, unknown>>;
  getHomeFeed(params: {
    lat: number;
    lng: number;
    fulfilment: 'delivery' | 'pickup';
    cuisine: string | null;
    sort: string;
    limit: number;
    offset: number;
  }): Promise<{
    feed: Record<string, unknown>;
    banners: readonly Record<string, unknown>[];
    flashCampaigns: readonly Record<string, unknown>[];
  }>;
  getVendorHeader(slug: string): Promise<Record<string, unknown> | null>;
  getVendorMenuDetail(slug: string): Promise<Record<string, unknown> | null>;
  getVendorReviews(slug: string, limit: number, cursorCreatedAt: string | null): Promise<readonly Record<string, unknown>[]>;
  searchCatalog(params: {
    query: string;
    lat: number;
    lng: number;
    fulfilment: 'delivery' | 'pickup';
    limit: number;
  }): Promise<readonly Record<string, unknown>[]>;
  getSeoSitemapData(): Promise<{
    zones: readonly Record<string, unknown>[];
    cuisines: readonly Record<string, unknown>[];
    vendors: readonly Record<string, unknown>[];
  }>;
  getOwnProfile(userId: string): Promise<Record<string, unknown> | null>;
  updateOwnProfile(
    userId: string,
    patch: { full_name?: string; language?: 'en' | 'bn'; avatar_url?: string | null },
  ): Promise<Record<string, unknown>>;
  upsertDeviceToken(params: {
    profileId: string;
    fcmToken: string;
    appFlavor: 'customer' | 'partner' | 'rider';
    platform: 'android' | 'web';
    appVersion: string | null;
    oemBrand: string | null;
    alarmReady: boolean;
  }): Promise<Record<string, unknown>>;
  listNotifications(profileId: string, limit: number, unreadOnly: boolean): Promise<readonly Record<string, unknown>[]>;
  markNotificationsRead(profileId: string, ids: readonly string[] | null): Promise<number>;
  countUserPublicUploadsToday(ownerProfileId: string): Promise<number>;
  insertMediaAsset(input: {
    ownerProfileId: string;
    provider: 'imgbb' | 'cloudinary';
    category: PublicImgbbCategory | SensitiveCloudinaryCategory;
    deliveryType: 'upload' | 'authenticated';
    cloudinaryPublicId: string;
    publicCdnUrl: string | null;
    mediumUrl: string | null;
    thumbUrl: string | null;
    imgbbDeleteUrl: string | null;
    bytes: number;
    width: number | null;
    height: number | null;
    format: string | null;
  }): Promise<StoredMediaAssetRow>;
  getMediaAssetById(assetId: string): Promise<StoredMediaAssetRow | null>;
  hasAdminPermission(profileId: string, permissionKey: string): Promise<boolean>;
  insertAuditLog(entry: {
    actorId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    diff: Record<string, unknown>;
    requestId: string;
  }): Promise<void>;
}

export interface ApiWorkerEnv {
  readonly SERVICE_NAME?: string;
  readonly ENVIRONMENT?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SUPABASE_JWT_SECRET?: string;
  readonly IMGBB_API_KEY?: string;
  readonly CLOUDINARY_CLOUD_NAME?: string;
  readonly CLOUDINARY_UNSIGNED_PRESET_SECURE?: string;
  readonly CLOUDINARY_API_KEY?: string;
  readonly CLOUDINARY_API_SECRET?: string;
  readonly QR_SIGNING_SECRET?: string;
  /** Optional injected adapter/fetcher used by real PostgreSQL 16 integration suites. */
  readonly __dbAdapter?: ApiDbAdapter;
  readonly __fetchImpl?: typeof fetch;
}

/**
 * @file workers/api/src/types.ts
 * @description Shared types, environment bindings, and pluggable PostgreSQL/PostgREST repository contract
 * for `W1 undal-api` (`Build Responses 6–7` — Part 1 + Part 2 Complete).
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

export interface OrderAccessContext {
  readonly order: Record<string, unknown>;
  readonly vendor: {
    readonly id: string;
    readonly slug?: string | null;
    readonly owner_profile_id: string;
    readonly type: string;
    readonly lat: number;
    readonly lng: number;
    readonly public_area_label: string;
    readonly address_text_private: string;
    readonly counter_phone: string;
    readonly pickup_point_label: string | null;
  };
  readonly riderProfileId: string | null;
  readonly staffRole: string | null;
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

  /* --- Build Response 7 (`W1 undal-api` Part 2): Addresses, Favourites, Cart, Orders, Chat, Reviews & Operators --- */
  listCustomerAddresses(profileId: string): Promise<readonly Record<string, unknown>[]>;
  saveCustomerAddress(input: {
    profileId: string;
    addressId: string | null;
    label: string;
    lat: number;
    lng: number;
    addressText: string;
    deliveryInstructions: string | null;
    isDefault: boolean;
  }): Promise<Record<string, unknown>>;
  deleteCustomerAddress(profileId: string, addressId: string): Promise<boolean>;
  listFavourites(customerId: string): Promise<readonly Record<string, unknown>[]>;
  toggleFavourite(customerId: string, vendorId: string): Promise<{ is_favourite: boolean }>;
  listAvailableVouchers(customerId: string): Promise<readonly Record<string, unknown>[]>;

  getCartWithItems(customerId: string): Promise<{
    cart: Record<string, unknown> | null;
    items: readonly Record<string, unknown>[];
  }>;
  upsertCartSession(input: {
    customerId: string;
    vendorId: string;
    addressId: string | null;
    fulfilment: 'delivery' | 'pickup';
    tipPoisha: number;
    cutleryRequested: boolean;
    customerNote: string | null;
    changeForPoisha: number | null;
    confirmClear: boolean;
  }): Promise<{ cart: Record<string, unknown>; clearedPrevious: boolean }>;
  mutateCartItem(input: {
    customerId: string;
    menuItemId: string;
    variantId: string | null;
    qty: number;
    selections: readonly unknown[];
    note: string | null;
  }): Promise<{ cart: Record<string, unknown>; items: readonly Record<string, unknown>[] }>;
  setCartVoucher(customerId: string, voucherCode: string | null): Promise<Record<string, unknown>>;
  validateCartPricing(customerId: string, isPriority: boolean): Promise<Record<string, unknown>>;

  placeOrder(input: {
    customerId: string;
    idempotencyKey: string;
    expectedCodPoisha: number | null;
    isPriority: boolean;
  }): Promise<Record<string, unknown>>;
  listActorOrders(profileId: string, role: UserRole, limit: number): Promise<readonly Record<string, unknown>[]>;
  getOrderAccessContext(idOrCode: string, viewerProfileId: string): Promise<OrderAccessContext | null>;
  getOrderItemsAndEvents(orderId: string): Promise<{
    items: readonly Record<string, unknown>[];
    events: readonly Record<string, unknown>[];
  }>;
  transitionOrder(input: {
    orderId: string;
    actorId: string;
    actorKind: 'customer' | 'vendor' | 'rider' | 'admin' | 'system';
    toStatus: string;
    meta: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  snoozeMenuItems(vendorId: string, itemIds: readonly string[], minutes: number): Promise<number>;
  verifyPickupHandover(input: {
    orderId: string;
    actorProfileId: string;
    secret: string;
    qrToken: string | null;
    code4: string | null;
    feedbackRating: number | null;
    feedbackTags: readonly string[];
  }): Promise<Record<string, unknown>>;
  recordRiderPickupFeedback(
    orderId: string,
    rating: number,
    tags: readonly string[],
  ): Promise<Record<string, unknown>>;
  getRiderCashGateByProfile(profileId: string): Promise<Record<string, unknown> | null>;

  listCustomerOrderReviews(orderId: string, reviewerId: string): Promise<readonly Record<string, unknown>[]>;
  submitOrderReview(input: {
    orderId: string;
    reviewerId: string;
    direction: 'customer_to_vendor' | 'customer_to_rider' | 'rider_to_vendor' | 'vendor_to_customer';
    rating: number;
    aspectTags: readonly string[];
    comment: string | null;
    photoUrls: readonly string[];
  }): Promise<Record<string, unknown>>;
  replyToReview(reviewId: string, vendorOperatorId: string, replyText: string): Promise<Record<string, unknown> | null>;

  listOrderChatMessages(
    orderId: string,
    pairKind: 'customer_rider' | 'customer_vendor' | 'rider_vendor',
  ): Promise<{ chat: Record<string, unknown> | null; messages: readonly Record<string, unknown>[] }>;
  postOrderChatMessage(input: {
    orderId: string;
    pairKind: 'customer_rider' | 'customer_vendor' | 'rider_vendor';
    senderId: string;
    body: string | null;
    mediaPublicId: string | null;
    voiceDurationSec: number | null;
  }): Promise<Record<string, unknown>>;

  listSupportThreads(requesterId: string, isAdmin: boolean): Promise<readonly Record<string, unknown>[]>;
  createSupportThread(input: {
    requesterId: string;
    requesterRole: 'customer' | 'vendor_owner' | 'vendor_staff' | 'rider';
    orderId: string | null;
    category: string;
    subject: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    initialBody: string;
    attachmentPublicIds: readonly string[];
  }): Promise<{ thread: Record<string, unknown>; message: Record<string, unknown> }>;
  listSupportMessages(
    threadId: string,
    viewerId: string,
    isAdmin: boolean,
  ): Promise<readonly Record<string, unknown>[] | null>;
  postSupportMessage(input: {
    threadId: string;
    senderId: string;
    isAdmin: boolean;
    body: string;
    attachmentPublicIds: readonly string[];
  }): Promise<Record<string, unknown> | null>;

  getOperatorVendor(profileId: string): Promise<{
    vendor: Record<string, unknown>;
    operatorRole: 'owner' | 'manager' | 'kitchen_staff';
  } | null>;
  updateOperatorVendor(
    vendorId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  upsertMenuCategory(
    vendorId: string,
    categoryId: string | null,
    input: { name_en: string; name_bn: string | null; sort: number; is_active: boolean },
  ): Promise<Record<string, unknown>>;
  upsertMenuItem(
    vendorId: string,
    itemId: string | null,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  submitVendorKycDoc(
    vendorId: string,
    docType: string,
    storagePath: string,
    expiresOn: string | null,
  ): Promise<Record<string, unknown>>;
  getVendorFinanceSummary(
    vendorId: string,
    includePayoutDetails: boolean,
  ): Promise<Record<string, unknown>>;

  getRiderSelfProfile(profileId: string): Promise<Record<string, unknown> | null>;
  submitRiderKycDoc(
    profileId: string,
    docType: string,
    storagePath: string,
    expiresOn: string | null,
  ): Promise<Record<string, unknown>>;
  submitRiderRemittance(input: {
    profileId: string;
    method: 'bkash' | 'nagad' | 'bank';
    amountPoisha: number;
    bkashTrxid: string;
    senderNumber: string;
    senderName: string | null;
    screenshotPublicId: string;
    selfiePublicId: string | null;
  }): Promise<Record<string, unknown>>;
  getRiderFinanceSummary(profileId: string): Promise<Record<string, unknown> | null>;
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
  readonly REALTIME_WORKER_URL?: string;
  readonly INTERNAL_HMAC_SECRET?: string;
  readonly TURNSTILE_SECRET_KEY?: string;
  /** Optional injected adapter/fetcher used by real PostgreSQL 16 integration suites. */
  readonly __dbAdapter?: ApiDbAdapter;
  readonly __fetchImpl?: typeof fetch;
}

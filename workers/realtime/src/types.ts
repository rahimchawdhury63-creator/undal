/**
 * @file workers/realtime/src/types.ts
 * @description Strict domain, Durable Object, geo-proxy, and PostgREST database adapter types
 * for `W2 undal-realtime` (`Master Guide File 06`, `File 08 §8.2`, `File 11`, `File 12`, `File 14`).
 */

import type {
  CalculatedRiderFare,
  FarePolicyConfig,
  RiderVehicleType,
  WeatherCondition,
} from '@undal/shared-ts';

export type AccountRole = 'customer' | 'vendor_owner' | 'vendor_staff' | 'rider' | 'admin';

export interface AuthPrincipal {
  readonly sub: string;
  readonly role: AccountRole;
  readonly status: 'active' | 'suspended' | 'deleted';
  readonly email: string | null;
  readonly phone: string | null;
}

/** Derived presence states (`File 12 §12.1` & `D-05`). */
export type PresenceStatus = 'LIVE' | 'STALE' | 'OFFLINE';

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface ZonePolygonRecord {
  readonly id: string;
  readonly slug: string;
  readonly nameEn: string;
  readonly isActive: boolean;
  readonly ring: readonly GeoPoint[];
  readonly roadFactor: number;
}

export interface PresenceHeartbeatInput {
  readonly kind: 'vendor' | 'rider';
  readonly lat?: number;
  readonly lng?: number;
  readonly accuracyM?: number;
  readonly heading?: number;
  readonly speedMps?: number;
  readonly capacityUsed?: number;
  readonly appState?: 'fg' | 'bg' | 'alarm_service';
  readonly batteryPct?: number;
}

export interface PresenceRecord {
  readonly profileId: string;
  readonly kind: 'vendor' | 'rider';
  readonly refId: string;
  readonly zoneId: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly geohash: string | null;
  readonly heading: number | null;
  readonly speedMps: number | null;
  readonly capacityUsed: number;
  readonly appState: 'fg' | 'bg' | 'alarm_service';
  readonly batteryPct: number | null;
  readonly lastSeenAtMs: number;
}

export interface RiderSessionPreFlight {
  readonly riderId: string;
  readonly profileId: string;
  readonly vehicleType: RiderVehicleType;
  readonly dateOfBirthIso: string;
  readonly kycStatus: string;
  readonly isActive: boolean;
  readonly isOnline: boolean;
  readonly cashGateBlocked: boolean;
  readonly homeZoneId: string;
  readonly hasValidDrivingLicense: boolean;
  readonly unremittedCashPoisha: number;
  readonly cashCeilingPoisha: number;
  readonly warn80Pct: boolean;
}

export interface RiderCandidate {
  readonly riderId: string;
  readonly profileId: string;
  readonly vehicleType: RiderVehicleType;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
  readonly capacityUsed: number;
  readonly ratingAvg90d: number;
  readonly ratingCount: number;
  readonly completionRate30d: number;
  readonly acceptanceHealth: number;
  readonly batteryPct: number | null;
  readonly lastSeenAtMs: number;
  readonly idleMinutes: number;
  readonly cashInHandPoisha: number;
  readonly cashCeilingPoisha: number;
  readonly cashGateBlocked: boolean;
  readonly kycStatus: string;
  readonly isActive: boolean;
  readonly isOnline: boolean;
  readonly hasFailedDeliveryHold: boolean;
  readonly headingVendorId: string | null;
  readonly headingDropPoint: GeoPoint | null;
}

export interface DispatchOrderSnapshot {
  readonly orderId: string;
  readonly publicCode: string;
  readonly zoneId: string;
  readonly vendorId: string;
  readonly customerId: string;
  readonly fulfilment: 'delivery' | 'pickup';
  readonly status: string;
  readonly vendorPoint: GeoPoint;
  readonly customerPoint: GeoPoint;
  readonly itemsPoisha: number;
  readonly foodPayablePoisha: number;
  readonly codCollectPoisha: number;
  readonly isPriority: boolean;
  readonly prepReadyAtMs: number;
  readonly placedAtMs: number;
  readonly bagUnits: number;
}

export interface AssignmentScoreFactors {
  readonly proximity: number;
  readonly readinessSync: number;
  readonly reliability: number;
  readonly rating: number;
  readonly fairness: number;
  readonly batchFit: number;
  readonly penalties: number;
  readonly etaToVendorMinutes: number;
  readonly toVendorKm: number;
  readonly loadedKm: number;
}

export interface ScoredCandidate {
  readonly rider: RiderCandidate;
  readonly score: number;
  readonly factors: AssignmentScoreFactors;
  readonly fare: CalculatedRiderFare;
}

export interface OfferRecord {
  readonly id: string;
  readonly orderId: string;
  readonly batchId: string | null;
  readonly batchOrderIds: readonly string[];
  readonly zoneId: string;
  readonly riderId: string;
  readonly riderProfileId: string;
  readonly farePoisha: number;
  readonly fareBreakdown: CalculatedRiderFare;
  readonly score: number;
  readonly scoreFactors: AssignmentScoreFactors;
  readonly soloRider: boolean;
  readonly response: 'pending' | 'accepted' | 'rejected' | 'reassign_requested' | 'expired';
  readonly rejectReason: string | null;
  readonly offeredAtMs: number;
  readonly expiresAtMs: number;
  readonly respondedAtMs: number | null;
  readonly attemptNumber: number;
}

export interface ZoneSdrSnapshot {
  readonly zoneId: string;
  readonly activeOrders: number;
  readonly activeRiders: number;
  readonly sdr: number;
  readonly surgeMotorbike: number;
  readonly surgeBicycle: number;
  readonly weatherCondition: WeatherCondition;
  readonly hotspots: readonly { geohash6: string; openOrders: number; center: GeoPoint }[];
  readonly computedAtIso: string;
}

export interface GeocodePlace {
  readonly displayName: string;
  readonly lat: number;
  readonly lng: number;
  readonly plusCode: string;
  readonly source: 'cache' | 'nominatim' | 'plus_code_fallback';
}

export interface RouteLegEstimate {
  readonly distanceKm: number;
  readonly durationMinutes: number;
  readonly trafficDelayMinutes: number;
  readonly geometry: string | null;
  readonly source: 'cache' | 'osrm' | 'haversine_fallback';
}

/** Durable Object KV storage subset compatible with Cloudflare Workers runtime & local tests. */
export interface DurableStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm?(scheduledTime: number | Date): Promise<void>;
}

export interface DurableStateLike {
  readonly storage: DurableStorageLike;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

export interface DurableNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export interface RealtimeDbAdapter {
  ping(): Promise<boolean>;
  getProfileAuthState(userId: string): Promise<AuthPrincipal | null>;
  getOperatorIdentity(profileId: string, role: AccountRole): Promise<{ kind: 'vendor' | 'rider'; refId: string; zoneId: string } | null>;
  upsertPresence(profileId: string, kind: 'vendor' | 'rider', refId: string, zoneId: string, input: PresenceHeartbeatInput, nowMs: number): Promise<PresenceRecord>;
  getPresence(profileId: string): Promise<PresenceRecord | null>;
  getRiderPreFlight(profileId: string): Promise<RiderSessionPreFlight | null>;
  hasFreshShiftSelfie(profileId: string, storagePath: string, nowMs: number): Promise<boolean>;
  startRiderShift(params: { riderId: string; zoneId: string; vehicleType: RiderVehicleType; selfiePath: string; lat: number; lng: number; profileId: string; nowMs: number }): Promise<{ shiftId: string; startedAtIso: string }>;
  endRiderShift(params: { riderId: string; endReason: 'normal' | 'cash_gate' | 'admin' | 'timeout'; nowMs: number }): Promise<{ shiftEnded: boolean; unremittedCashPoisha: number; cashCeilingPoisha: number; cashGateBlocked: boolean }>;
  getDispatchOrder(orderId: string): Promise<DispatchOrderSnapshot | null>;
  listUnassignedZoneOrders(zoneId: string): Promise<readonly DispatchOrderSnapshot[]>;
  listZoneRiderCandidates(zoneId: string, nowMs: number): Promise<readonly RiderCandidate[]>;
  getZoneWeather(zoneId: string, nowMs: number): Promise<{ condition: WeatherCondition; source: 'open_meteo' | 'met_norway' | 'admin_override'; expiresAtMs: number } | null>;
  upsertZoneWeather(zoneId: string, condition: WeatherCondition, tempC: number | null, precipMm: number | null, source: 'open_meteo' | 'met_norway' | 'admin_override', ttlSeconds: number, nowMs: number): Promise<void>;
  getFarePolicy(): Promise<FarePolicyConfig>;
  listZones(): Promise<readonly ZonePolygonRecord[]>;
  getGeocodeCache(cacheKey: string, nowMs: number): Promise<Record<string, unknown> | null>;
  putGeocodeCache(cacheKey: string, kind: 'forward' | 'reverse' | 'route_osrm', payload: Record<string, unknown>, ttlSeconds: number, nowMs: number): Promise<void>;
  persistBatchAndOffer(offer: OfferRecord): Promise<void>;
  persistOfferDecision(offer: OfferRecord): Promise<void>;
  markVendorUnreachable(orderId: string, nowMs: number): Promise<boolean>;
  getIdempotencyRecord(key: string, actorId: string, nowMs: number): Promise<{ requestHash: string; status: number; body: Record<string, unknown> } | null>;
  saveIdempotencyRecord(key: string, actorId: string, endpoint: string, requestHash: string, status: number, body: Record<string, unknown>, nowMs: number): Promise<void>;
  getActiveRtdbLeaseCount(nowMs: number): Promise<number>;
  listDeviceTokensForProfiles?(profileIds: readonly string[]): Promise<readonly { profileId: string; fcmToken: string; appFlavor: string }[]>;
  pruneDeviceToken?(fcmToken: string): Promise<void>;
  logFcmDispatch?(entry: { orderId: string | null; recipientId: string; eventType: string; httpStatus: number; latencyMs: number; errorCode: string | null; nowMs: number }): Promise<void>;
  listVendorOutletProfileIds?(vendorId: string): Promise<readonly string[]>;
  getOrderAccessMeta?(orderId: string): Promise<{ orderId: string; publicCode: string; customerId: string; vendorId: string; riderId: string | null; status: string } | null>;
}

export interface RealtimeWorkerEnv {
  readonly SERVICE_NAME?: string;
  readonly RTDB_LEASE_HARD_CAP?: string;
  readonly REALTIME_MODE?: 'rtdb' | 'polling';
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SUPABASE_JWT_SECRET?: string;
  readonly INTERNAL_HMAC_SECRET?: string;
  readonly FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  readonly FIREBASE_RTDB_URL?: string;
  readonly UNDAL_BKASH_NUMBER?: string;
  readonly UNDAL_NAGAD_NUMBER?: string;
  readonly OSRM_BASE_URL?: string;
  readonly NOMINATIM_BASE_URL?: string;
  readonly NOMINATIM_CONTACT_EMAIL?: string;
  readonly MET_NORWAY_BASE_URL?: string;
  readonly OPEN_METEO_BASE_URL?: string;
  readonly ZONE_DISPATCH?: DurableNamespaceLike;
  /** Optional dependency-injected overrides used by deterministic integration tests. */
  readonly dbAdapter?: RealtimeDbAdapter;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
}

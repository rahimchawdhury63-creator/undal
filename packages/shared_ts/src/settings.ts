/**
 * @file packages/shared_ts/src/settings.ts
 * @description Canonical UNDAL Platform Settings Registry (`Appendix M` + `D-09` = 72 original
 * seed entries, extended with the Build 14 priority-delivery surcharge for 73 runtime keys) edited via Super Admin `C13–C15`.
 */

export interface PlatformSettingSeed<T = number | string | boolean> {
  readonly group:
    | 'money'
    | 'fare'
    | 'dispatch'
    | 'orders'
    | 'cash'
    | 'alerts'
    | 'ranking'
    | 'realtime'
    | 'apps'
    | 'media'
    | 'auth';
  readonly defaultValue: T;
  readonly descriptionEn: string;
}

/** Frozen 72-key Appendix M + D-09 seed registry applied by migrations `0001..0004`. */
export const UNDAL_BASE_PLATFORM_SETTINGS = {
  'money.commission_pct': { group: 'money', defaultValue: 15, descriptionEn: 'Vendor commission % on discounted food payable' },
  'money.tax_vat_incl_pct': { group: 'money', defaultValue: 5, descriptionEn: 'VAT-inclusive extraction % (D-08: 5/105)' },
  'money.rider_bonus_pct': { group: 'money', defaultValue: 3, descriptionEn: 'Rider food bonus % from extracted tax stream (D-07)' },
  'money.platform_fee_poisha': { group: 'money', defaultValue: 500, descriptionEn: 'Customer service fee on delivery orders (poisha)' },
  'money.invoice_rider_day': { group: 'money', defaultValue: 'FRI', descriptionEn: 'Weekly rider settlement generation day (Asia/Dhaka)' },
  'money.invoice_vendor_day': { group: 'money', defaultValue: 'SAT', descriptionEn: 'Weekly partner settlement generation day (Asia/Dhaka)' },

  'fare.base_motorbike_poisha': { group: 'fare', defaultValue: 3000, descriptionEn: 'Motorbike base fare (poisha)' },
  'fare.base_bicycle_poisha': { group: 'fare', defaultValue: 2500, descriptionEn: 'Bicycle base fare (poisha)' },
  'fare.per_km_motorbike_poisha': { group: 'fare', defaultValue: 1400, descriptionEn: 'Motorbike per-km rate (poisha)' },
  'fare.per_km_bicycle_poisha': { group: 'fare', defaultValue: 800, descriptionEn: 'Bicycle per-km rate (poisha)' },
  'fare.included_km': { group: 'fare', defaultValue: 2.0, descriptionEn: 'Distance km covered by base fare' },
  'fare.deadhead_factor': { group: 'fare', defaultValue: 0.5, descriptionEn: 'To-vendor deadhead leg multiplier' },
  'fare.floor_motorbike_poisha': { group: 'fare', defaultValue: 4000, descriptionEn: 'Minimum motorbike payout floor (poisha)' },
  'fare.floor_bicycle_poisha': { group: 'fare', defaultValue: 3000, descriptionEn: 'Minimum bicycle payout floor (poisha)' },
  'fare.surge_mid_low': { group: 'fare', defaultValue: 1.2, descriptionEn: 'SDR 0.5..1.0 band low multiplier' },
  'fare.surge_mid_high': { group: 'fare', defaultValue: 1.4, descriptionEn: 'SDR 0.5..1.0 band high multiplier' },
  'fare.surge_severe_low': { group: 'fare', defaultValue: 1.5, descriptionEn: 'SDR < 0.5 band low multiplier' },
  'fare.surge_severe_cap': { group: 'fare', defaultValue: 2.2, descriptionEn: 'Hard maximum surge cap' },
  'fare.weather_rain_pct': { group: 'fare', defaultValue: 20, descriptionEn: 'Rain weather boost %' },
  'fare.weather_storm_pct': { group: 'fare', defaultValue: 40, descriptionEn: 'Storm weather boost %' },
  'fare.weather_heat_pct': { group: 'fare', defaultValue: 10, descriptionEn: 'Extreme heat weather boost %' },
  'fare.traffic_block_minutes': { group: 'fare', defaultValue: 5, descriptionEn: 'Minutes per traffic delay compensation block' },
  'fare.traffic_block_poisha': { group: 'fare', defaultValue: 400, descriptionEn: 'Poisha paid per traffic delay block' },
  'fare.batch_factor_2': { group: 'fare', defaultValue: 0.6, descriptionEn: '2nd batched order base-fare factor' },
  'fare.batch_factor_3': { group: 'fare', defaultValue: 0.5, descriptionEn: '3rd batched order base-fare factor' },
  'fare.priority_uplift_poisha': { group: 'fare', defaultValue: 1000, descriptionEn: 'Priority delivery rider uplift (poisha)' },
  'fare.wait_comp_per_min_poisha': { group: 'fare', defaultValue: 200, descriptionEn: 'Kitchen wait compensation per min beyond grace' },

  'dispatch.bicycle_max_km': { group: 'dispatch', defaultValue: 4, descriptionEn: 'Maximum loaded leg km for bicycle offers' },
  'dispatch.motorbike_max_km': { group: 'dispatch', defaultValue: 12, descriptionEn: 'Maximum loaded leg km for standard motorbike offers' },
  'dispatch.offer_ttl_sec': { group: 'dispatch', defaultValue: 30, descriptionEn: 'Rider offer countdown seconds' },
  'dispatch.vendor_respond_ttl_sec': { group: 'dispatch', defaultValue: 180, descriptionEn: 'Max kitchen accept window seconds' },
  'dispatch.vendor_unreachable_cancel_sec': { group: 'dispatch', defaultValue: 120, descriptionEn: 'Auto-cancel seconds when kitchen presence is stale' },
  'dispatch.presence_heartbeat_sec': { group: 'dispatch', defaultValue: 10, descriptionEn: 'Active delivery GPS ping interval seconds' },
  'dispatch.presence_stale_sec': { group: 'dispatch', defaultValue: 25, descriptionEn: 'Seconds until presence marked stale' },
  'dispatch.presence_offline_sec': { group: 'dispatch', defaultValue: 60, descriptionEn: 'Seconds until presence marked offline' },
  'dispatch.max_concurrent_bicycle': { group: 'dispatch', defaultValue: 2, descriptionEn: 'Max concurrent orders for bicycle' },
  'dispatch.max_concurrent_motorbike': { group: 'dispatch', defaultValue: 3, descriptionEn: 'Max concurrent orders for motorbike' },
  'dispatch.batch_max_orders': { group: 'dispatch', defaultValue: 3, descriptionEn: 'Hard cap on orders per batch' },
  'dispatch.batch_ready_window_min': { group: 'dispatch', defaultValue: 8, descriptionEn: 'Max ready-time spread minutes for batching' },
  'dispatch.batch_detour_max_min': { group: 'dispatch', defaultValue: 6, descriptionEn: 'Max customer detour minutes for batching' },

  'orders.prep_min_minutes': { group: 'orders', defaultValue: 5, descriptionEn: 'Minimum committed kitchen prep minutes' },
  'orders.prep_max_minutes': { group: 'orders', defaultValue: 200, descriptionEn: 'Maximum committed kitchen prep minutes' },
  'orders.prep_reason_above_min': { group: 'orders', defaultValue: 60, descriptionEn: 'Prep minutes above which reason note is required' },
  'orders.customer_wait_min': { group: 'orders', defaultValue: 8, descriptionEn: 'Customer doorstep wait protocol minutes' },
  'orders.pickup_noshow_min': { group: 'orders', defaultValue: 15, descriptionEn: 'Customer self-pickup grace window after ready' },

  'cash.ceiling_bicycle_poisha': { group: 'cash', defaultValue: 300000, descriptionEn: 'Bicycle COD cash-in-hand ceiling (৳3,000)' },
  'cash.ceiling_motorbike_poisha': { group: 'cash', defaultValue: 500000, descriptionEn: 'Motorbike COD cash-in-hand ceiling (৳5,000)' },
  'cash.ceiling_warn_pct': { group: 'cash', defaultValue: 80, descriptionEn: 'Cash ceiling warning banner threshold %' },

  'alerts.vendor_ring_max_sec': { group: 'alerts', defaultValue: 120, descriptionEn: 'Max continuous kitchen alarm ring seconds' },
  'alerts.customer_eta_slip_notify_min': { group: 'alerts', defaultValue: 10, descriptionEn: 'Notify customer when ETA slips by N minutes' },

  'ranking.w_rating': { group: 'ranking', defaultValue: 0.30, descriptionEn: 'rank_v1 Bayesian star rating weight' },
  'ranking.w_prep': { group: 'ranking', defaultValue: 0.20, descriptionEn: 'rank_v1 prep accuracy weight' },
  'ranking.w_accept': { group: 'ranking', defaultValue: 0.20, descriptionEn: 'rank_v1 acceptance reliability weight' },
  'ranking.w_ontime': { group: 'ranking', defaultValue: 0.15, descriptionEn: 'rank_v1 on-time handover weight' },
  'ranking.w_complaint_free': { group: 'ranking', defaultValue: 0.15, descriptionEn: 'rank_v1 complaint-free order weight' },
  'ranking.new_vendor_prior_weight': { group: 'ranking', defaultValue: 10, descriptionEn: 'Bayesian prior review count for new kitchens' },

  'realtime.mode': { group: 'realtime', defaultValue: 'rtdb', descriptionEn: 'Active realtime transport (rtdb | polling)' },
  'realtime.gps_min_displacement_m': { group: 'realtime', defaultValue: 25, descriptionEn: 'Minimum movement meters to push GPS update' },
  'realtime.gps_min_interval_sec': { group: 'realtime', defaultValue: 4, descriptionEn: 'Minimum seconds between RTDB GPS writes' },

  'apps.min_supported_version': { group: 'apps', defaultValue: '1.0.0', descriptionEn: 'Force-upgrade minimum app version' },
  'media.vendor_img_per_day': { group: 'media', defaultValue: 30, descriptionEn: 'Daily ImgBB proxy uploads allowed per vendor' },

  // D-09 Auth provider toggles (Email + Phone + Google active on Day 1; others config-ready)
  'auth.providers.email': { group: 'auth', defaultValue: true, descriptionEn: 'Enable Email + Password auth' },
  'auth.providers.phone': { group: 'auth', defaultValue: true, descriptionEn: 'Enable BD Phone auth' },
  'auth.providers.google': { group: 'auth', defaultValue: true, descriptionEn: 'Enable Sign in with Google' },
  'auth.providers.facebook': { group: 'auth', defaultValue: false, descriptionEn: 'Enable Facebook OAuth (D-09 toggle)' },
  'auth.providers.apple': { group: 'auth', defaultValue: false, descriptionEn: 'Enable Sign in with Apple (D-09 toggle)' },
  'auth.providers.github': { group: 'auth', defaultValue: false, descriptionEn: 'Enable GitHub OAuth (D-09 toggle)' },
  'auth.providers.microsoft': { group: 'auth', defaultValue: false, descriptionEn: 'Enable Microsoft OAuth (D-09 toggle)' },
  'auth.providers.discord': { group: 'auth', defaultValue: false, descriptionEn: 'Enable Discord OAuth (D-09 toggle)' },
  'auth.providers.twitter': { group: 'auth', defaultValue: false, descriptionEn: 'Enable X/Twitter OAuth (D-09 toggle)' },
  'auth.providers.linkedin': { group: 'auth', defaultValue: false, descriptionEn: 'Enable LinkedIn OAuth (D-09 toggle)' },
  'auth.providers.anonymous_browse': { group: 'auth', defaultValue: true, descriptionEn: 'Allow guest browsing before checkout' },
} as const satisfies Record<string, PlatformSettingSeed>;

/** Current runtime registry: the frozen seed set plus additive settings from later build responses. */
export const UNDAL_PLATFORM_SETTINGS = {
  ...UNDAL_BASE_PLATFORM_SETTINGS,
  'money.priority_delivery_fee_poisha': {
    group: 'money',
    defaultValue: 2000,
    descriptionEn: 'Customer surcharge for priority delivery (poisha)',
  },
} as const satisfies Record<string, PlatformSettingSeed>;

export type PlatformSettingKey = keyof typeof UNDAL_PLATFORM_SETTINGS;

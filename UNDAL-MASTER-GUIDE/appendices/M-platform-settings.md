# Appendix M · Platform Settings Registry (`platform_settings` — Admin-editable, never hard-coded)

Every business constant in files 10-13 maps to a key here. Changes are versioned + audit-logged (file 09).
Zone overrides live in `zones.config` with same key names.
**Registered keys: 62** (+ 10 more `auth.providers.*` toggles).


| Group | Key | Default | Type | Meaning |
|---|---|---|---|---|
| money | `money.commission_pct` | `15` | number | Vendor commission % |
| money | `money.tax_vat_incl_pct` | `5` | number | VAT-inclusive extraction % (D-08) |
| money | `money.rider_bonus_pct` | `3` | number | Rider bonus % of food payable, from tax stream (D-07) |
| money | `money.platform_fee_poisha` | `500` | int | Customer platform fee |
| money | `money.invoice_rider_day` | `FRI` | enum | Rider invoice generation day |
| money | `money.invoice_vendor_day` | `SAT` | enum | Vendor invoice generation day |
| fare | `fare.base_motorbike_poisha` | `3000` | int | Base fare motorbike |
| fare | `fare.base_bicycle_poisha` | `2500` | int | Base fare bicycle |
| fare | `fare.per_km_motorbike_poisha` | `1400` | int | ৳14/km founder rate |
| fare | `fare.per_km_bicycle_poisha` | `800` | int | ৳8/km founder rate |
| fare | `fare.included_km` | `2.0` | number | Km covered by base |
| fare | `fare.deadhead_factor` | `0.5` | number | To-vendor leg payment factor |
| fare | `fare.floor_motorbike_poisha` | `4000` | int | Minimum fare motorbike |
| fare | `fare.floor_bicycle_poisha` | `3000` | int | Minimum fare bicycle |
| fare | `fare.surge_mid_low` | `1.2` | number | SDR 0.5-1.0 band low |
| fare | `fare.surge_mid_high` | `1.4` | number | SDR 0.5-1.0 band high |
| fare | `fare.surge_severe_low` | `1.5` | number | SDR<0.5 band low |
| fare | `fare.surge_severe_cap` | `2.2` | number | Hard surge cap |
| fare | `fare.weather_rain_pct` | `20` | number |  |
| fare | `fare.weather_storm_pct` | `40` | number |  |
| fare | `fare.weather_heat_pct` | `10` | number |  |
| fare | `fare.traffic_block_minutes` | `5` | number |  |
| fare | `fare.traffic_block_poisha` | `400` | int | per 5-min delay block |
| fare | `fare.batch_factor_2` | `0.6` | number | 2nd order base factor |
| fare | `fare.batch_factor_3` | `0.5` | number | 3rd order base factor |
| fare | `fare.priority_uplift_poisha` | `1000` | int | Rider priority uplift |
| fare | `fare.wait_comp_per_min_poisha` | `200` | int | Vendor-wait compensation/min after grace |
| dispatch | `dispatch.bicycle_max_km` | `4` | number |  |
| dispatch | `dispatch.motorbike_max_km` | `12` | number |  |
| dispatch | `dispatch.offer_ttl_sec` | `30` | int |  |
| dispatch | `dispatch.vendor_respond_ttl_sec` | `180` | int |  |
| dispatch | `dispatch.vendor_unreachable_cancel_sec` | `120` | int | Founder 2-minute rule |
| dispatch | `dispatch.presence_heartbeat_sec` | `10` | int |  |
| dispatch | `dispatch.presence_stale_sec` | `25` | int |  |
| dispatch | `dispatch.presence_offline_sec` | `60` | int |  |
| dispatch | `dispatch.max_concurrent_bicycle` | `2` | int |  |
| dispatch | `dispatch.max_concurrent_motorbike` | `3` | int |  |
| dispatch | `dispatch.batch_max_orders` | `3` | int |  |
| dispatch | `dispatch.batch_ready_window_min` | `8` | int |  |
| dispatch | `dispatch.batch_detour_max_min` | `6` | int |  |
| orders | `orders.prep_min_minutes` | `5` | int |  |
| orders | `orders.prep_max_minutes` | `200` | int | Founder cap |
| orders | `orders.prep_reason_above_min` | `60` | int |  |
| orders | `orders.customer_wait_min` | `8` | int | Rider wait at door protocol |
| orders | `orders.pickup_noshow_min` | `15` | int |  |
| cash | `cash.ceiling_bicycle_poisha` | `300000` | int | ৳3,000 |
| cash | `cash.ceiling_motorbike_poisha` | `500000` | int | ৳5,000 |
| cash | `cash.ceiling_warn_pct` | `80` | int |  |
| alerts | `alerts.vendor_ring_max_sec` | `120` | int |  |
| alerts | `alerts.customer_eta_slip_notify_min` | `10` | int |  |
| ranking | `ranking.w_rating` | `0.30` | number | Stage-4 weights file 13 |
| ranking | `ranking.w_prep` | `0.20` | number |  |
| ranking | `ranking.w_accept` | `0.20` | number |  |
| ranking | `ranking.w_ontime` | `0.15` | number |  |
| ranking | `ranking.w_complaint_free` | `0.15` | number |  |
| ranking | `ranking.new_vendor_prior_weight` | `10` | int | Bayesian pseudo-reviews |
| realtime | `realtime.mode` | `rtdb` | enum | rtdb|polling kill-switch |
| realtime | `realtime.gps_min_displacement_m` | `25` | int |  |
| realtime | `realtime.gps_min_interval_sec` | `4` | int |  |
| apps | `apps.min_supported_version` | `1.0.0` | string | Force-upgrade gate |
| media | `media.vendor_img_per_day` | `30` | int | ImgBB proxy rate |
| auth | `auth.providers.google` | `true` | bool | D-09 plugin toggles x11 |
/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Dispatch, presence and weather — the live floor — 32 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const DISPATCH_KEYS = [
  // dispatch
  "dispatch.read",
  "dispatch.list_live",
  "dispatch.assign",
  "dispatch.force_assign",
  "dispatch.unassign",
  "dispatch.reassign",
  "dispatch.lock",
  "dispatch.unlock",
  "dispatch.expand_radius",
  "dispatch.set_wave",
  "dispatch.pause_zone",
  "dispatch.resume_zone",
  "dispatch.view_map",
  "dispatch.view_fleet",
  "dispatch.view_queue",
  "dispatch.override_eta",
  "dispatch.trigger_redispatch",
  "dispatch.blacklist_rider",
  "dispatch.whitelist_rider",
  "dispatch.view_heatmap",
  // dispatch.presence
  "dispatch.presence.read",
  "dispatch.presence.view_location_history",
  "dispatch.presence.view_shift_selfie",
  "dispatch.presence.force_offline",
  "dispatch.presence.force_online",
  "dispatch.presence.view_battery_posture",
  // dispatch.weather
  "dispatch.weather.read",
  "dispatch.weather.refresh",
  "dispatch.weather.set_surge_override",
  "dispatch.weather.clear_surge_override",
  "dispatch.weather.view_observations",
  "dispatch.weather.configure_threshold",
] as const;

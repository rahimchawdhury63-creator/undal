/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The Brain: weights, models and traces — 6 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const BRAIN_KEYS = [
  // brain.weights
  "brain.weights.read",
  "brain.weights.edit",
  "brain.weights.tune",
  // brain.model
  "brain.model.read",
  // brain.trace
  "brain.trace.read",
  "brain.trace.replay",
] as const;

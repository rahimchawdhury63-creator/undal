/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * KYC: documents, queues and decisions — 20 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const KYC_KEYS = [
  // kyc.document
  "kyc.document.read",
  "kyc.document.list",
  "kyc.document.view_nid_front",
  "kyc.document.view_nid_back",
  "kyc.document.view_selfie",
  "kyc.document.view_liveness",
  "kyc.document.approve",
  "kyc.document.reject",
  "kyc.document.request_resubmission",
  "kyc.document.delete",
  // kyc.queue
  "kyc.queue.read",
  "kyc.queue.list",
  "kyc.queue.claim",
  "kyc.queue.release",
  "kyc.queue.view_stats",
  "kyc.queue.export",
  // kyc.decision
  "kyc.decision.read",
  "kyc.decision.create",
  "kyc.decision.override",
  "kyc.decision.view_history",
] as const;

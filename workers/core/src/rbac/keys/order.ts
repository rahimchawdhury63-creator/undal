/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Orders, from quote to settlement — 44 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const ORDER_KEYS = [
  // order
  "order.read",
  "order.list",
  "order.create",
  "order.cancel",
  "order.force_cancel",
  "order.accept",
  "order.reject",
  "order.pickup",
  "order.deliver",
  "order.complete",
  "order.refund",
  "order.view_cost_breakdown",
  "order.view_customer_contact",
  "order.send_receipt",
  // order.item
  "order.item.read",
  "order.item.add",
  "order.item.update",
  "order.item.remove",
  "order.item.substitute",
  "order.item.view_price_override",
  // order.state
  "order.state.read",
  "order.state.list",
  "order.state.replay",
  "order.state.force_transition",
  "order.state.view_internal_notes",
  // order.offer
  "order.offer.read",
  "order.offer.list",
  "order.offer.create",
  "order.offer.expire",
  "order.offer.cancel",
  "order.offer.view_rider_identity",
  // order.batch
  "order.batch.read",
  "order.batch.create",
  "order.batch.add_order",
  "order.batch.remove_order",
  "order.batch.dissolve",
  // order.proof
  "order.proof.read",
  "order.proof.upload",
  "order.proof.delete",
  "order.proof.verify",
  // order.rating
  "order.rating.read",
  "order.rating.moderate",
  // order.dispute
  "order.dispute.read",
  "order.dispute.resolve",
] as const;

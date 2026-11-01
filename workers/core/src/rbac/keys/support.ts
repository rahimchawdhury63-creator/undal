/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Support: tickets, messages, exceptions, notifications, credits — 30 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const SUPPORT_KEYS = [
  // support.ticket
  "support.ticket.read",
  "support.ticket.list",
  "support.ticket.create",
  "support.ticket.assign",
  "support.ticket.reassign",
  "support.ticket.respond",
  "support.ticket.escalate",
  "support.ticket.close",
  "support.ticket.reopen",
  "support.ticket.view_sla",
  // support.message
  "support.message.read",
  "support.message.send",
  "support.message.attach_media",
  "support.message.delete",
  "support.message.view_internal",
  "support.message.add_internal_note",
  // support.exception
  "support.exception.read",
  "support.exception.list",
  "support.exception.acknowledge",
  "support.exception.resolve",
  "support.exception.configure_trigger",
  // support.notification
  "support.notification.read",
  "support.notification.list",
  "support.notification.send",
  "support.notification.bulk_send",
  "support.notification.configure",
  // support.credit
  "support.credit.read",
  "support.credit.issue",
  "support.credit.reverse",
  "support.credit.view_cap",
] as const;

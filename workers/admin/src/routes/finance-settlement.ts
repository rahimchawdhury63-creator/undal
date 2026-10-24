/**
 * @file workers/admin/src/routes/finance-settlement.ts
 * @description Domain 5 — Finance, Weekly Settlement, Cash Gate & Reports (`C71–C89`):
 *   - Weekly Invoices (`C71–C77`): queue, lazy/manual generator, zero-drift recompute check,
 *     Step-Up `VERIFIED` (**strict dual-control: `verified_by !== paid_by`!**), Step-Up `PAID`
 *     with `1.85%` bKash cash-out fee cover, dispute hold, bilingual `EN/বাংলা` printable statement
 *   - Rider COD Cash Remittances (`C78–C80`): queue + Step-Up full/partial approve or reject
 *     via `decide_cash_remittance` (auto-unlocking `riders.cash_gate_blocked`)
 *   - Penalties & Adjustments (`C81–C83`): create, Step-Up dual-control approve, dispute resolve
 *   - Immutable Ledger & Reports (`C84–C89`): actor ledger, single-order poisha waterfall,
 *     unit economics, `5/105` extracted VAT + `3%` rider bonus pool, CSV payout pack, cash position
 */

import { formatBdt } from '@undal/shared-ts';
import {
  adminJsonErr,
  adminJsonOk,
  authorizeAdminCapability,
  readJsonBody,
} from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

const DUAL_CONTROL_ADJUSTMENT_THRESHOLD_POISHA = 50_000; // ৳500

/** Handles all Domain 5 Finance, Settlement, Cash Remittance, Adjustment & Report routes (`C71–C89`). */
export async function handleFinanceSettlementRoutes(params: {
  readonly request: Request;
  readonly url: URL;
  readonly requestId: string;
  readonly principal: AdminPrincipal;
  readonly db: AdminDbAdapter;
  readonly env: AdminWorkerEnv;
  readonly nowMs: number;
  readonly ip: string | undefined;
}): Promise<Response | null> {
  const { request, url, requestId, principal, db, env, nowMs, ip } = params;
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const primaryRole = principal.roleKeys[0] ?? 'admin';

  // --- C71 & C77: Weekly Invoice Queue, Lazy Generator & Bulk Verify ---
  if (path === '/v1/admin/invoices' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const pt = url.searchParams.get('payee_type');
    const payeeType = pt === 'vendor' || pt === 'rider' ? pt : undefined;
    const invoices = await db.listInvoices({
      payeeType,
      state: url.searchParams.get('state') ?? undefined,
    });
    return adminJsonOk({ invoices }, requestId);
  }

  if (path === '/v1/admin/invoices/generate' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      payee_type?: 'vendor' | 'rider';
      period_start?: string;
      period_end?: string;
      cashout_fee_bps?: number;
    }>(request);
    if (!body?.payee_type || !body.period_start || !body.period_end) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const generated = await db.generateWeeklyInvoicesBatch({
      payeeType: body.payee_type,
      periodStart: body.period_start,
      periodEnd: body.period_end,
      cashoutFeeBps: Math.round(Number(body.cashout_fee_bps ?? 185)),
      nowMs,
    });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'invoice.generate_batch',
      entityType: 'invoice_batch',
      entityId: `${body.payee_type}:${body.period_start}..${body.period_end}`,
      diff: { generatedCount: generated.length },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ count: generated.length, invoices: generated }, requestId);
  }

  if (path === '/v1/admin/invoices/bulk-verify' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ invoice_ids?: readonly string[] }>(request);
    if (!Array.isArray(body?.invoice_ids) || body.invoice_ids.length === 0) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const verifiedIds: string[] = [];
    for (const invId of body.invoice_ids) {
      const check = await db.recomputeInvoiceCheck(invId);
      if (check && check.driftPoisha === 0) {
        const res = await db.verifyOrPayInvoice({
          invoiceId: invId, actorId: principal.profileId, action: 'verify', requestId, nowMs,
        });
        if (res.ok) verifiedIds.push(invId);
      }
    }
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'invoice.bulk_verify',
      entityType: 'invoice',
      entityId: verifiedIds.join(',') || 'none',
      diff: { requested: body.invoice_ids.length, verifiedCount: verifiedIds.length },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ verifiedIds }, requestId);
  }

  // --- Step-Up protected payout target reveal: decrypted in W3 only, and never written to audit logs. ---
  const payoutTargetMatch = path.match(/^\/v1\/admin\/invoices\/([^/]+)\/payout-target$/);
  if (payoutTargetMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'read', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const privateKey = env.VENDOR_PAYOUT_PRIVATE_KEY_PKCS8_B64?.trim() ?? '';
    if (!privateKey) return adminJsonErr('SERVER_BUSY', requestId, { reason: 'PAYOUT_DECRYPTION_NOT_CONFIGURED' });
    const target = await db.getVendorPayoutTargetForSettlement(payoutTargetMatch[1]!, privateKey);
    if (!target) return adminJsonErr('PAYOUT_ACCOUNT_REQUIRED', requestId, undefined, 422);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'invoice.payout_target.view',
      entityType: 'invoice', entityId: target.invoiceId,
      diff: { vendor_id: target.vendorId, method: target.method, holder_name: target.holderName, masked: target.masked },
      ip, requestId, nowMs,
    });
    return adminJsonOk({ payout_target: target }, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  // --- C72: Zero-Drift Recompute Check ---
  const recomputeMatch = path.match(/^\/v1\/admin\/invoices\/([^/]+)\/recompute$/);
  if (recomputeMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const res = await db.recomputeInvoiceCheck(recomputeMatch[1]!);
    if (!res) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(res, requestId);
  }

  // --- C73 & C74: Verify (`GENERATED -> VERIFIED`) & Pay (`VERIFIED -> PAID`, strict dual-control!) ---
  const invActionMatch = path.match(/^\/v1\/admin\/invoices\/([^/]+)\/(verify|pay)$/);
  if (invActionMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const invoiceId = invActionMatch[1]!;
    const action = invActionMatch[2] as 'verify' | 'pay';
    const body = await readJsonBody<{
      payout_method?: 'bkash' | 'nagad' | 'bank';
      payout_txn_ref?: string;
      payout_proof_public_id?: string;
      pdf_public_id?: string;
    }>(request);
    if (action === 'pay' && (!body?.payout_txn_ref || !body.payout_proof_public_id)) {
      return adminJsonErr('VALIDATION_FAILED', requestId, {
        required: ['payout_txn_ref', 'payout_proof_public_id'],
      });
    }
    const outcome = await db.verifyOrPayInvoice({
      invoiceId,
      actorId: principal.profileId,
      action,
      payoutMethod: body?.payout_method ?? 'bkash',
      payoutTxnRef: body?.payout_txn_ref,
      payoutProofPublicId: body?.payout_proof_public_id,
      pdfPublicId: body?.pdf_public_id,
      requestId,
      nowMs,
    });
    if (!outcome.ok) {
      if (outcome.reason === 'dual_control') {
        return adminJsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, {
          reason: 'dual_control_verifier_cannot_pay_same_invoice',
        });
      }
      return adminJsonErr('VALIDATION_FAILED', requestId, { reason: outcome.reason });
    }
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: `invoice.${action}`,
      entityType: 'invoice',
      entityId: invoiceId,
      diff: outcome.invoice,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(outcome.invoice, requestId);
  }

  // --- C75 & C76: Hold Disputed Invoice & Printable Bilingual Statement HTML/PDF ---
  const invDisputeMatch = path.match(/^\/v1\/admin\/invoices\/([^/]+)\/dispute$/);
  if (invDisputeMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ reason?: string }>(request);
    if (!body?.reason) return adminJsonErr('VALIDATION_FAILED', requestId);
    const updated = await db.disputeInvoice(invDisputeMatch[1]!, body.reason);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'invoice.dispute',
      entityType: 'invoice', entityId: invDisputeMatch[1]!, diff: updated, reason: body.reason, ip, requestId, nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  const invPdfMatch = path.match(/^\/v1\/admin\/invoices\/([^/]+)\/pdf$/);
  if (invPdfMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.invoices', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const check = await db.recomputeInvoiceCheck(invPdfMatch[1]!);
    if (!check) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    const inv = check.invoice;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${String(inv['invoice_number'])}</title></head><body><h1>UNDAL সাপ্তাহিক বিবরণী / Weekly Settlement Statement</h1><p>Invoice: <strong>${String(inv['invoice_number'])}</strong> · State: ${String(inv['state'])}</p><p>Net Payable / নিট প্রদেয়: <strong>${formatBdt(Number(inv['net_payable_poisha'] ?? 0))}</strong> (${formatBdt(Number(inv['net_payable_poisha'] ?? 0), 'bn')})</p><p>Total Disbursed (incl. 1.85% bKash cash-out cover): <strong>${formatBdt(Number(inv['total_disbursed_poisha'] ?? 0))}</strong></p></body></html>`;
    return adminJsonOk({ invoice: inv, lines: check.lines, printableHtml: html }, requestId);
  }

  // --- C78–C80: Rider COD Cash Remittance Queue & Decision (Auto-Unlocks Cash Gate!) ---
  if (path === '/v1/admin/remittances' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.remittances', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      { remittances: await db.listCashRemittances(url.searchParams.get('state') ?? undefined) },
      requestId,
    );
  }

  const remDecideMatch = path.match(/^\/v1\/admin\/remittances\/([^/]+)\/decide$/);
  if (remDecideMatch && method === 'POST') {
    const body = await readJsonBody<{
      decision?: 'verified' | 'partial' | 'rejected';
      verified_amount_poisha?: number;
      note?: string;
    }>(request);
    if (!body?.decision || !['verified', 'partial', 'rejected'].includes(body.decision)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const needsStepUp = body.decision !== 'rejected';
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.remittances', mode: 'write', requireStepUp: needsStepUp, env, nowMs,
    });
    if (deny) return deny;
    const decided = await db.decideCashRemittance({
      remittanceId: remDecideMatch[1]!,
      reviewerId: principal.profileId,
      decision: body.decision,
      verifiedAmountPoisha: body.verified_amount_poisha,
      note: body.note,
      requestId,
      nowMs,
    });
    if (!decided) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(decided, requestId);
  }

  // --- C81–C83: Penalties, Bonuses & Refund Adjustments ---
  if (path === '/v1/admin/adjustments' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.adjustments', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      target_type?: 'vendor' | 'rider';
      target_id?: string;
      order_id?: string;
      kind?: 'penalty' | 'bonus' | 'refund_adjustment';
      amount_poisha?: number;
      reason_code?: string;
      note?: string;
      evidence_public_id?: string;
    }>(request);
    if (!body?.target_type || !body.target_id || !body.kind || !body.amount_poisha || !body.reason_code) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const absAmount = Math.abs(Math.round(body.amount_poisha));
    const created = await db.createAdjustment({
      targetType: body.target_type,
      targetId: body.target_id,
      orderId: body.order_id,
      kind: body.kind,
      amountPoisha: Math.round(body.amount_poisha),
      reasonCode: body.reason_code,
      note: body.note,
      evidencePublicId: body.evidence_public_id,
      autoConfirm: absAmount < DUAL_CONTROL_ADJUSTMENT_THRESHOLD_POISHA,
      createdBy: principal.profileId,
    });
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'adjustment.create',
      entityType: 'penalties_adjustments', entityId: String(created['id']), diff: created, reason: body.note, ip, requestId, nowMs,
    });
    return adminJsonOk(created, requestId, 201);
  }

  const adjActionMatch = path.match(/^\/v1\/admin\/adjustments\/([^/]+)\/(approve|resolve)$/);
  if (adjActionMatch && method === 'POST') {
    const isApprove = adjActionMatch[2] === 'approve';
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.adjustments', mode: 'write', requireStepUp: isApprove, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ outcome?: 'confirmed' | 'cancelled'; note?: string }>(request);
    const res = await db.approveOrResolveAdjustment({
      adjustmentId: adjActionMatch[1]!,
      actorId: principal.profileId,
      action: isApprove ? 'confirmed' : (body?.outcome ?? 'cancelled'),
      note: body?.note,
    });
    if (!res.ok) {
      return adminJsonErr(
        res.reason === 'dual_control' ? 'AUTH_FORBIDDEN_PERMISSION' : 'VALIDATION_FAILED',
        requestId,
        { reason: res.reason },
      );
    }
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: `adjustment.${adjActionMatch[2]}`,
      entityType: 'penalties_adjustments', entityId: adjActionMatch[1]!, diff: res.adjustment, reason: body?.note, ip, requestId, nowMs,
    });
    return adminJsonOk(res.adjustment, requestId);
  }

  // --- C84–C89: Immutable Ledger Explorer, Order Waterfall & Finance Reports ---
  if (path === '/v1/admin/ledger' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.ledger', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      {
        entries: await db.queryLedgerEntries({
          actorType: url.searchParams.get('actor_type') ?? undefined,
          actorId: url.searchParams.get('actor_id') ?? undefined,
          limit: Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '100'))),
        }),
      },
      requestId,
    );
  }

  const wfMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/waterfall$/);
  if (wfMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.ledger', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const wf = await db.getOrderWaterfall(wfMatch[1]!);
    if (!wf) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(wf, requestId);
  }

  if (
    path === '/v1/admin/finance/reports/unit-economics' ||
    path === '/v1/admin/finance/reports/tax-and-pool' ||
    path === '/v1/admin/finance/reports/cash-position'
  ) {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.reports', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getFinanceSummary(nowMs), requestId);
  }

  if (path === '/v1/admin/finance/reports/settlement-pack' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '5.reports', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const verified = await db.listInvoices({ state: 'VERIFIED' });
    const csvLines = [
      'invoice_number,payee_type,payee_id,net_payable_poisha,cashout_fee_cover_poisha,total_disbursed_poisha',
      ...verified.map((r) =>
        [
          r['invoice_number'],
          r['payee_type'],
          r['payee_id'],
          r['net_payable_poisha'],
          r['cashout_fee_cover_poisha'],
          r['total_disbursed_poisha'],
        ].join(','),
      ),
    ];
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'finance.export',
      entityType: 'settlement_pack', entityId: 'csv', diff: { rows: verified.length }, ip, requestId, nowMs,
    });
    return adminJsonOk({ count: verified.length, csv: csvLines.join('\n') }, requestId);
  }

  return null;
}

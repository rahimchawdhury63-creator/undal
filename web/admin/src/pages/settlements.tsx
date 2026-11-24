/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The reviewer's settlement queue.
 *
 * This is the screen the cash system exists for: a rider has transferred money, claims they paid,
 * and is blocked from going online until somebody confirms it. The queue is ordered oldest first
 * because that ordering is the fairness rule — the top of the list is the claim closest to being
 * released automatically at the two-hour deadline.
 *
 * Two decisions are possible and both are irreversible in the rider's day: approve, which releases
 * the block and records an audit reason; and reject, which blocks them further and sends one of
 * nine codes the app turns into a specific instruction. A reviewer cannot type prose instead of a
 * code, because prose would have to be translated at 1 am by whoever reads it next.
 */

import { useEffect, useState, type ReactNode } from "react";

import {
  APPROVAL_REASONS,
  REJECTION_REASONS,
  approveSettlement,
  declarationQueue,
  escalateSettlement,
  rejectSettlement,
  settlementQueue,
  toApiError,
  type SettlementEntry,
} from "../lib/api.ts";
import { useCounts } from "../lib/counts.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { AmountCell, Badge, Button, Dialog, Empty, ErrorNote, Field, Kpi, Money, Note, Select, Table, TextArea } from "../components/kit.tsx";

/** Which decision the open dialog is collecting. */
type Decision = { readonly kind: "approve"; readonly entry: SettlementEntry } | { readonly kind: "reject"; readonly entry: SettlementEntry } | { readonly kind: "escalate"; readonly entry: SettlementEntry };

/** How old a claim is, in the words a reviewer uses. */
function ageLabel(minutes: number | null, t: ReturnType<typeof useT>): string {
  if (minutes === null) return "—";
  if (minutes < 60) return t.minutes(minutes);
  return `${t.number(Math.floor(minutes / 60))}h ${t.number(minutes % 60)}m`;
}

/** The settlement queue, with its three filters and its three decisions. */
export function SettlementsPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)() ?? "";
  const publish = useCounts((state) => state.publish);
  const [state, setState] = useState<"pending" | "decided" | "all">("pending");
  const [method, setMethod] = useState<"ALL" | "BKASH" | "NAGAD" | "BANK">("ALL");
  const [breachOnly, setBreachOnly] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const queue = useResource(
    async () =>
      settlementQueue(token, {
        state,
        ...(method === "ALL" ? {} : { method }),
        ...(breachOnly ? { breach: true } : {}),
        limit: 50,
      }),
    [token, state, method, breachOnly],
  );

  // The sidebar's count comes from the unfiltered pending view, not from whatever the reviewer has
  // narrowed the table to: a filter is a question, and the queue length is a fact.
  useEffect(() => {
    if (state !== "pending" || method !== "ALL" || breachOnly) return;
    const summary = queue.data?.summary;
    if (summary === undefined) return;
    publish(summary.pending, null);
  }, [queue.data, state, method, breachOnly, publish]);

  const openDeclarations = useResource(async () => declarationQueue(token, { state: "open", limit: 1 }), [token]);
  useEffect(() => {
    const summary = openDeclarations.data?.summary;
    if (summary === undefined) return;
    publish(queue.data?.summary.pending ?? null, summary.total);
  }, [openDeclarations.data, queue.data, publish]);

  const settle = async (work: () => Promise<unknown>, successKey: string) => {
    try {
      await work();
      setOutcome(t(successKey as never));
      setDecision(null);
      queue.reload();
    } catch (failure) {
      setOutcome(toApiError(failure).code);
    }
  };

  const summary = queue.data?.summary;

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.cash.title")}</h1>

      <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        <Kpi label={t("admin.cash.pending")} value={summary === undefined ? "—" : t.number(summary.pending)} hint={t("admin.cash.queueHint")} />
        <Kpi
          label={t("admin.cash.oldest")}
          value={summary?.oldestMinutes === null || summary === undefined ? "—" : ageLabel(summary.oldestMinutes, t)}
          tone={summary?.breaches === 0 || summary === undefined ? "neutral" : "danger"}
          hint={t("admin.cash.oldestHint")}
        />
        <Kpi
          label={t("admin.cash.breaches")}
          value={summary === undefined ? "—" : t.number(summary.breaches)}
          tone={summary?.breaches === 0 || summary === undefined ? "neutral" : "danger"}
          hint={t("admin.cash.breachesHint")}
        />
      </div>

      <div className={["toolbar", ""].join(" ")} role="group" aria-label={t("admin.cash.filters")} style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {(["pending", "decided", "all"] as const).map((option) => (
          <Button key={option} variant={state === option ? "primary" : "secondary"} onClick={() => setState(option)}>
            {t(`admin.cash.state.${option}` as never)}
          </Button>
        ))}
        <Button
          variant={breachOnly ? "danger" : "secondary"}
          onClick={() => setBreachOnly((value) => !value)}
          aria-pressed={breachOnly}
        >
          {t("admin.cash.breachOnly")}
        </Button>
        <Select
          id="method-filter"
          value={method}
          onChange={setMethod}
          options={[
            { value: "ALL", label: t("admin.cash.anyMethod") },
            { value: "BKASH", label: "bKash" },
            { value: "NAGAD", label: "Nagad" },
            { value: "BANK", label: t("admin.cash.bank") },
          ]}
        />
        <Button variant="quiet" onClick={queue.reload} busy={queue.loading}>
          {t("action.retry")}
        </Button>
      </div>

      {outcome === null ? null : <Note>{outcome}</Note>}
      {queue.error === null ? null : <ErrorNote error={queue.error} onRetry={queue.reload} />}

      {queue.data !== null && queue.data.settlements.length === 0 && queue.error === null ? (
        <Empty title={t("admin.cash.empty.title")} body={t("admin.cash.empty.body")} />
      ) : (
        <Table
          caption={t("admin.cash.title")}
          head={
            <tr>
              <th scope="col">{t("admin.cash.rider")}</th>
              <th scope="col">{t("admin.cash.amount")}</th>
              <th scope="col">{t("admin.cash.method")}</th>
              <th scope="col">{t("admin.cash.trxId")}</th>
              <th scope="col">{t("admin.cash.declaredAt")}</th>
              <th scope="col">{t("admin.cash.age")}</th>
              <th scope="col">{t("admin.cash.status")}</th>
              <th scope="col">{t("admin.cash.flags")}</th>
              <th scope="col">{t("admin.cash.decide")}</th>
            </tr>
          }
        >
          {(queue.data?.settlements ?? []).map((entry) => (
            <tr key={entry.id}>
              <td>
                <strong>{entry.rider.name ?? entry.rider.code ?? entry.rider.id.slice(0, 8)}</strong>
                {entry.rider.code === null ? null : <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{entry.rider.code}</div>}
              </td>
              <AmountCell>
                <Money paisa={entry.amountPaisa} strong />
              </AmountCell>
              <td>{entry.method}</td>
              <td style={{ fontFamily: "var(--font-family-mono)", fontSize: 12 }}>{entry.trxId ?? "—"}</td>
              <td>{t.dateTime(entry.submittedAt, "day")}</td>
              <td style={{ color: entry.slaBreached ? "var(--color-status-danger)" : undefined }}>{ageLabel(entry.ageMinutes, t)}</td>
              <td>
                <Badge tone={entry.status === "PENDING" ? "warning" : entry.status === "CONFIRMED" ? "success" : "danger"}>{entry.status}</Badge>
              </td>
              <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {entry.slaBreached ? <Badge tone="danger">{t("admin.cash.flag.sla")}</Badge> : null}
                {entry.partial ? <Badge tone="info">{t("admin.cash.flag.partial")}</Badge> : null}
                {entry.escalated ? <Badge tone="warning">{t("admin.cash.flag.escalated")}</Badge> : null}
                {entry.numberMatches === false ? <Badge tone="danger">{t("admin.cash.flag.number")}</Badge> : null}
                {entry.nameMatches === false ? <Badge tone="warning">{t("admin.cash.flag.name")}</Badge> : null}
              </td>
              <td>
                {entry.status === "PENDING" ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button onClick={() => setDecision({ kind: "approve", entry })}>{t("admin.cash.approve")}</Button>
                    <Button variant="danger" onClick={() => setDecision({ kind: "reject", entry })}>
                      {t("admin.cash.reject")}
                    </Button>
                    <Button variant="quiet" onClick={() => setDecision({ kind: "escalate", entry })}>
                      {t("admin.cash.escalate")}
                    </Button>
                  </div>
                ) : (
                  <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
                    {entry.approvedPaisa === null ? entry.rejectionReason ?? "—" : t.money(entry.approvedPaisa)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {decision === null ? null : (
        <DecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
          onApprove={(reason, note) =>
            void settle(() => approveSettlement(token, decision.entry.id, reason, note), "admin.cash.approved")
          }
          onReject={(reason, note) => void settle(() => rejectSettlement(token, decision.entry.id, reason, note), "admin.cash.rejected")}
          onEscalate={(note) => void settle(() => escalateSettlement(token, decision.entry.id, note), "admin.cash.escalated")}
        />
      )}
    </>
  );
}

/**
 * The dialog that collects a decision.
 *
 * The reason list is closed and comes from the contract, and `OTHER` demands a sentence because a
 * code the rider cannot act on is a wall with a label on it.
 */
function DecisionDialog({
  decision,
  onClose,
  onApprove,
  onReject,
  onEscalate,
}: {
  readonly decision: Decision;
  readonly onClose: () => void;
  readonly onApprove: (reason: (typeof APPROVAL_REASONS)[number], note: string | null) => void;
  readonly onReject: (reason: (typeof REJECTION_REASONS)[number], note: string | null) => void;
  readonly onEscalate: (note: string) => void;
}): ReactNode {
  const t = useT();
  const [approvalReason, setApprovalReason] = useState<(typeof APPROVAL_REASONS)[number]>(APPROVAL_REASONS[0]);
  const [rejectionReason, setRejectionReason] = useState<(typeof REJECTION_REASONS)[number]>(REJECTION_REASONS[0]);
  const [note, setNote] = useState("");
  const entry = decision.entry;
  const trimmed = note.trim();
  const needsNote = decision.kind === "escalate" || (decision.kind === "reject" && rejectionReason === "OTHER");
  const blocked = needsNote && trimmed.length < 3;

  return (
    <Dialog
      title={
        decision.kind === "approve"
          ? t("admin.cash.approveTitle")
          : decision.kind === "reject"
            ? t("admin.cash.rejectTitle")
            : t("admin.cash.escalateTitle")
      }
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant={decision.kind === "reject" ? "danger" : "primary"}
            disabled={blocked}
            onClick={() => {
              if (decision.kind === "approve") onApprove(approvalReason, trimmed === "" ? null : trimmed);
              else if (decision.kind === "reject") onReject(rejectionReason, trimmed === "" ? null : trimmed);
              else onEscalate(trimmed);
            }}
          >
            {decision.kind === "approve"
              ? t("admin.cash.approve")
              : decision.kind === "reject"
                ? t("admin.cash.reject")
                : t("admin.cash.escalate")}
          </Button>
        </>
      }
    >
      <p style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
        <strong>{entry.rider.name ?? entry.rider.code ?? entry.rider.id.slice(0, 8)}</strong>
        <Money paisa={entry.amountPaisa} strong />
        <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>{entry.method}</span>
      </p>

      {entry.slaBreached ? <Note>{t("admin.cash.slaWarning")}</Note> : null}

      {decision.kind === "approve" ? (
        <Field id="approval-reason" label={t("admin.cash.reason")}>
          <Select
            id="approval-reason"
            value={approvalReason}
            onChange={setApprovalReason}
            options={APPROVAL_REASONS.map((code) => ({ value: code, label: t(`reason.${code}` as never) }))}
          />
        </Field>
      ) : null}

      {decision.kind === "reject" ? (
        <Field id="rejection-reason" label={t("admin.cash.reason")}>
          <Select
            id="rejection-reason"
            value={rejectionReason}
            onChange={setRejectionReason}
            options={REJECTION_REASONS.map((code) => ({ value: code, label: t(`reason.${code}` as never) }))}
          />
        </Field>
      ) : null}

      <Field id="decision-note" label={needsNote ? t("admin.cash.noteRequired") : t("admin.cash.note")}>
        <TextArea id="decision-note" value={note} onChange={setNote} />
      </Field>
      {blocked ? <p style={{ color: "var(--color-status-danger)", fontSize: 13 }}>{t("admin.cash.noteTooShort")}</p> : null}
    </Dialog>
  );
}


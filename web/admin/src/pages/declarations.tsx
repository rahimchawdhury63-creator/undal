/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The exception queue: robberies, disputes and emergencies.
 *
 * `25 §7` lifts a rider's cash block the moment they declare, so nothing here is urgent in the way
 * a settlement is — the rider is already back online. What is urgent is that somebody answers, and
 * that only one person answers: a claim is what stops two operators ringing the same rider twice.
 * The write-off is the one irreversible action on this screen, and it asks for a sentence an
 * auditor will read next year rather than a click.
 */

import { useEffect, useState, type ReactNode } from "react";

import { claimDeclaration, declarationQueue, releaseDeclaration, toApiError, writeOffRider, type DeclarationEntry } from "../lib/api.ts";
import { useCounts } from "../lib/counts.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { useResource } from "../lib/use-resource.ts";
import { AmountCell, Badge, Button, Dialog, Empty, ErrorNote, Field, Money, Note, Select, Table, TextArea } from "../components/kit.tsx";

/** The three kinds of declaration, as the contract spells them. */
const KINDS = ["ROBBED", "DISPUTE", "EMERGENCY"] as const;

/** Robberies, disputes and emergencies, with claim, release and write-off. */
export function DeclarationsPage(): ReactNode {
  const t = useT();
  const token = useSession((state) => state.token)();
  const publish = useCounts((state) => state.publish);
  const [view, setView] = useState<"open" | "resolved" | "all">("open");
  const [kind, setKind] = useState<"ALL" | (typeof KINDS)[number]>("ALL");
  const [writingOff, setWritingOff] = useState<DeclarationEntry | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const queue = useResource(
    async () => declarationQueue(token ?? "", { state: view, ...(kind === "ALL" ? {} : { kind }), limit: 50 }),
    [token, view, kind],
  );

  useEffect(() => {
    if (view !== "open" || kind !== "ALL") return;
    const summary = queue.data?.summary;
    if (summary === undefined) return;
    publish(null, summary.total);
  }, [queue.data, view, kind, publish]);

  const act = async (work: () => Promise<unknown>, successKey: string) => {
    try {
      await work();
      setOutcome(t(successKey as never));
      queue.reload();
      setWritingOff(null);
    } catch (failure) {
      setOutcome(toApiError(failure).code);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: "var(--type-heading-lg-size)" }}>{t("admin.exceptions")}</h1>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }} role="group" aria-label={t("admin.declarations.filters")}>
        {(["open", "resolved", "all"] as const).map((option) => (
          <Button key={option} variant={view === option ? "primary" : "secondary"} onClick={() => setView(option)}>
            {t(`admin.declarations.view.${option}` as never)}
          </Button>
        ))}
        <Select
          id="kind-filter"
          value={kind}
          onChange={setKind}
          options={[
            { value: "ALL", label: t("admin.declarations.anyKind") },
            ...KINDS.map((value) => ({ value, label: t(`admin.declarations.kind.${value}` as never) })),
          ]}
        />
      </div>

      {outcome === null ? null : <Note>{outcome}</Note>}
      {queue.error === null ? null : <ErrorNote error={queue.error} onRetry={queue.reload} />}

      {queue.data !== null && queue.data.declarations.length === 0 && queue.error === null ? (
        <Empty title={t("admin.exceptions.none")} body={t("admin.declarations.empty.body")} />
      ) : (
        <Table
          caption={t("admin.exceptions")}
          head={
            <tr>
              <th scope="col">{t("admin.cash.rider")}</th>
              <th scope="col">{t("admin.declarations.kind")}</th>
              <th scope="col">{t("admin.declarations.note")}</th>
              <th scope="col">{t("admin.cash.outstanding")}</th>
              <th scope="col">{t("admin.declarations.difference")}</th>
              <th scope="col">{t("admin.cash.declaredAt")}</th>
              <th scope="col">{t("admin.cash.decide")}</th>
            </tr>
          }
        >
          {(queue.data?.declarations ?? []).map((entry) => {
            const riderId = typeof entry.riderId === "string" ? entry.riderId : null;
            const status = typeof entry.status === "string" ? entry.status : "OPEN";
            return (
              <tr key={entry.id}>
                <td>{typeof entry.riderName === "string" && entry.riderName !== "" ? entry.riderName : riderId?.slice(0, 8) ?? "—"}</td>
                <td>
                  <Badge tone={entry.kind === "ROBBED" ? "danger" : entry.kind === "DISPUTE" ? "warning" : "info"}>{entry.kind}</Badge>
                </td>
                <td style={{ whiteSpace: "normal", maxWidth: 320 }}>{typeof entry.note === "string" ? entry.note : "—"}</td>
                <AmountCell>{typeof entry.outstandingPaisa === "number" ? <Money paisa={entry.outstandingPaisa} /> : "—"}</AmountCell>
                <AmountCell>{typeof entry.snapshotDifferencePaisa === "number" ? <Money paisa={entry.snapshotDifferencePaisa} /> : "—"}</AmountCell>
                <td>{typeof entry.createdAt === "string" ? t.dateTime(entry.createdAt, "day") : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button variant="secondary" onClick={() => void act(() => claimDeclaration(token ?? "", entry.id), "admin.declarations.claimed")}>
                      {t("admin.declarations.claim")}
                    </Button>
                    <Button variant="quiet" onClick={() => void act(() => releaseDeclaration(token ?? "", entry.id), "admin.declarations.released")}>
                      {t("admin.declarations.release")}
                    </Button>
                    {status === "RESOLVED" || riderId === null ? null : (
                      <Button variant="danger" onClick={() => setWritingOff(entry)}>
                        {t("admin.declarations.writeOff")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {writingOff === null ? null : (
        <WriteOffDialog
          entry={writingOff}
          onClose={() => setWritingOff(null)}
          onSubmit={(reason) =>
            void act(
              () => writeOffRider(token ?? "", typeof writingOff.riderId === "string" ? writingOff.riderId : "", reason),
              "admin.declarations.writtenOff",
            )
          }
        />
      )}
    </>
  );
}

/** The write-off dialog: the one action here that changes a ledger, so it asks why. */
function WriteOffDialog({
  entry,
  onClose,
  onSubmit,
}: {
  readonly entry: DeclarationEntry;
  readonly onClose: () => void;
  readonly onSubmit: (reason: string) => void;
}): ReactNode {
  const t = useT();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      title={t("admin.declarations.writeOffTitle")}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
            {t("admin.declarations.writeOff")}
          </Button>
        </>
      }
    >
      <Note>{t("admin.declarations.writeOffWarning")}</Note>
      <p style={{ display: "flex", gap: "var(--space-3)" }}>
        <strong>{typeof entry.riderName === "string" ? entry.riderName : entry.id.slice(0, 8)}</strong>
        {typeof entry.outstandingPaisa === "number" ? <Money paisa={entry.outstandingPaisa} strong /> : null}
      </p>
      <Field id="writeoff-reason" label={t("admin.cash.noteRequired")}>
        <TextArea id="writeoff-reason" value={reason} onChange={setReason} />
      </Field>
    </Dialog>
  );
}

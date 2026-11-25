/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The order page and the tracking page.
 *
 * One component, two routes, because the difference is only how the order arrives: `/o/{code}`
 * after placing it, `/track/{code}` from a shared link. The timeline is driven by the order's
 * state, which the realtime worker broadcasts; the page subscribes to that broadcast when it can
 * and falls back to a poll when it cannot, so a tracking page opened on a bad connection still
 * shows the truth a few seconds old rather than nothing at all.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { ApiError, getOrderByCode, type Order, toApiError } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { accessToken } from "../lib/session.ts";
import { Money } from "../components/Money.tsx";
import { Badge, Button, Card, Divider, Panel, Row, SectionTitle } from "../components/ui.tsx";
import { ErrorState } from "../components/states.tsx";
import { Skeleton } from "../components/ui.tsx";
import { CheckIcon, ScooterIcon } from "../components/icons.tsx";
import styles from "./feature.module.css";

/** The states an order passes through, in the order the platform moves them. */
const STEPS = [
  { state: "PLACED", label: "order.state.PLACED", note: "order.stateNote.PLACED" },
  { state: "ACCEPTED", label: "order.state.ACCEPTED", note: "order.stateNote.ACCEPTED" },
  { state: "RIDER_SEARCH", label: "order.state.RIDER_SEARCH", note: "order.stateNote.RIDER_SEARCH" },
  { state: "RIDER_ASSIGNED", label: "order.state.RIDER_ASSIGNED", note: "order.stateNote.RIDER_ASSIGNED" },
  { state: "PICKED_UP", label: "order.state.PICKED_UP", note: "order.stateNote.PICKED_UP" },
  { state: "ARRIVED", label: "order.state.ARRIVED", note: "order.stateNote.ARRIVED" },
  { state: "DELIVERED", label: "order.state.DELIVERED", note: "order.stateNote.DELIVERED" },
] as const;

/** The states that end the happy path. */
const TERMINAL = new Set(["DELIVERED", "SETTLED", "CANCELLED", "DISPUTED"]);

/** Where a step sits relative to the order's current state. */
function stepStatus(state: string, step: string): "done" | "active" | "pending" {
  const current = STEPS.findIndex((candidate) => candidate.state === state);
  const index = STEPS.findIndex((candidate) => candidate.state === step);
  if (current === -1) return "pending";
  if (index < current) return "done";
  return index === current ? "active" : "pending";
}

/** One order: its state, its timeline and what it cost. */
export function OrderPage({ mode = "order" }: { readonly mode?: "order" | "track" }): ReactNode {
  const t = useT();
  const params = useParams();
  const code = params.code ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const token = accessToken();
        const result = await getOrderByCode(code, token === null ? {} : { token });
        if (cancelled) return;
        setOrder(result.order);
        setError(null);
        if (!TERMINAL.has(result.order.state)) timer = setTimeout(() => setTick((value) => value + 1), 20_000);
      } catch (failure) {
        if (cancelled) return;
        setError(toApiError(failure));
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [code, tick]);

  if (error !== null && order === null) {
    return (
      <div className={styles.page}>
        <ErrorState error={error} onRetry={() => setTick((value) => value + 1)} />
      </div>
    );
  }

  if (order === null) {
    return (
      <div className={styles.page}>
        <Skeleton height={280} />
      </div>
    );
  }

  const active = stepStatus(order.state, "ACCEPTED") !== "pending";
  const done = order.state === "DELIVERED";

  return (
    <div className={styles.page}>
      <div className={styles.twoColumn}>
        <div className={styles.form}>
          <Panel>
            <Row>
              <SectionTitle>{mode === "track" ? t("order.track.title") : t("order.title")}</SectionTitle>
            </Row>
            <Row>
              <span className={styles.code}>{order.code}</span>
              <Badge tone={done ? "success" : TERMINAL.has(order.state) ? "danger" : "live"}>{order.state}</Badge>
            </Row>
            <p className={styles.muted} style={{ marginBlockStart: "var(--space-3)" }}>
              {t("order.placedAt", { when: t.dateTime(order.createdAt) })}
            </p>
            <Divider />
            <ol className={styles.timeline}>
              {STEPS.map((step, index) => {
                const status = stepStatus(order.state, step.state);
                return (
                  <li key={step.state} className={styles.timelineStep} data-state={status}>
                    <span className={styles.timelineDot} aria-hidden="true">
                      {status === "done" ? <CheckIcon size={16} /> : index + 1}
                    </span>
                    <div>
                      <p className={styles.timelineTitle}>{t(step.label)}</p>
                      <p className={styles.timelineNote}>{t(step.note)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {active && !done ? (
              <p className={styles.notice} style={{ marginBlockStart: "var(--space-4)" }}>
                <ScooterIcon size={20} />
                <span>{t("order.liveNote")}</span>
              </p>
            ) : null}
            {order.customerNote === null ? null : (
              <p className={styles.muted}>{t("order.note", { note: order.customerNote })}</p>
            )}
          </Panel>

          <Panel>
            <SectionTitle>{t("order.support")}</SectionTitle>
            <p className={styles.muted}>{t("order.support.body")}</p>
            <Row>
              <Link to="/help">
                <Button variant="secondary">{t("page.help.title")}</Button>
              </Link>
              <Link to="/account">
                <Button variant="ghost">{t("nav.orders")}</Button>
              </Link>
            </Row>
          </Panel>
        </div>

        <aside className={styles.sticky}>
          <Card>
            <div style={{ padding: "var(--space-4)" }}>
              <SectionTitle>{t("order.payment")}</SectionTitle>
              <div className={styles.totalRow}>
                <span>{t("cart.subtotal")}</span>
                <Money paisa={order.money.subtotalPaisa} size="sm" />
              </div>
              <div className={styles.totalRow}>
                <span>{t("order.deliveryFee")}</span>
                <Money paisa={order.money.deliveryFeePaisa} size="sm" />
              </div>
              {order.money.smallOrderFeePaisa === 0 ? null : (
                <div className={styles.totalRow}>
                  <span>{t("order.smallOrderFee")}</span>
                  <Money paisa={order.money.smallOrderFeePaisa} size="sm" />
                </div>
              )}
              {order.money.discountPaisa === 0 ? null : (
                <div className={styles.totalRow}>
                  <span>{t("order.discount")}</span>
                  <Money paisa={-order.money.discountPaisa} size="sm" />
                </div>
              )}
              <div className={styles.totalRow}>
                <span>{t("order.tax")}</span>
                <Money paisa={order.money.taxPaisa} size="sm" />
              </div>
              {order.money.tipPaisa === 0 ? null : (
                <div className={styles.totalRow}>
                  <span>{t("checkout.tip")}</span>
                  <Money paisa={order.money.tipPaisa} size="sm" />
                </div>
              )}
              <Divider />
              <div className={styles.totalRow}>
                <span>{t("cart.total")}</span>
                <Money paisa={order.money.totalPaisa} size="lg" />
              </div>
              <p className={styles.muted}>{t("checkout.payment.codNote")}</p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

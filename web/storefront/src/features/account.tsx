/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The account screen and the sign-in screen.
 *
 * Sign-in is a phone number and a password because that is what the API authenticates, and the
 * screen does not pretend otherwise: no "continue with" buttons that lead nowhere, no one-time code
 * field the platform cannot send yet.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ApiError, listOrders, type Order } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { Money } from "../components/Money.tsx";
import { Badge, Button, Card, Field, Input, Panel, Row, SectionTitle } from "../components/ui.tsx";
import { EmptyState, ErrorState } from "../components/states.tsx";
import styles from "./feature.module.css";

/** The signed-in customer's profile and history. */
export function AccountPage(): ReactNode {
  const t = useT();
  const session = useSession();
  const [orders, setOrders] = useState<readonly Order[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (session.status === "unknown") void session.restore();
  }, [session]);

  useEffect(() => {
    if (session.status !== "signed-in") return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await listOrders();
        if (!cancelled) setOrders(result.orders);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof ApiError ? failure : new ApiError("NETWORK", 0, null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.status]);

  if (session.status !== "signed-in") {
    return (
      <div className={styles.page}>
        <EmptyState
          title={t("account.signedOut.title")}
          body={t("account.signedOut.body")}
          actionLabel={t("account.signIn")}
          to="/sign-in?next=%2Faccount"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Panel>
        <SectionTitle
          action={
            <Button variant="ghost" size="sm" onClick={() => void session.signOut()}>
              {t("account.signOut")}
            </Button>
          }
        >
          {t("account.title")}
        </SectionTitle>
        <p className={styles.muted}>{session.user?.phone ?? session.user?.userId ?? ""}</p>
        <p className={styles.muted}>{t("account.role", { role: session.user?.role ?? "" })}</p>
      </Panel>

      <section className={styles.section} aria-label={t("nav.orders")}>
        <SectionTitle>{t("nav.orders")}</SectionTitle>
        {error !== null ? (
          <ErrorState error={error} compact onRetry={() => window.location.reload()} />
        ) : orders === null ? (
          <Card>
            <p className={styles.muted} style={{ padding: "var(--space-4)" }}>
              {t("state.loading")}
            </p>
          </Card>
        ) : orders.length === 0 ? (
          <EmptyState compact title={t("account.empty.title")} body={t("account.empty.body")} actionLabel={t("cart.empty.action")} to="/" />
        ) : (
          <Card>
            {orders.map((order) => (
              <Link key={order.id} to={`/o/${order.code}`} className={styles.lineRow} style={{ paddingInline: "var(--space-4)" }}>
                <div>
                  <p className={styles.lineName}>
                    {t("order.code", { code: order.code })}
                  </p>
                  <p className={styles.lineOptions}>
                    {t.dateTime(order.createdAt)} · {order.fulfilment === "PICKUP" ? t("checkout.pickup") : t("checkout.delivery")}
                  </p>
                </div>
                <Row>
                  <Badge tone={order.state === "DELIVERED" ? "success" : "neutral"}>{order.state}</Badge>
                  <Money paisa={order.money.totalPaisa} size="sm" />
                </Row>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

/** Phone-and-password sign-in, returning to the page that asked for it. */
export function SignInPage(): ReactNode {
  const t = useT();
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const error = session.error;
  const phoneValid = /^\+?8801[3-9]\d{8}$/u.test(phone.replace(/[\s-]/gu, "")) || /^01[3-9]\d{8}$/u.test(phone.replace(/[\s-]/gu, ""));

  if (session.status === "signed-in") {
    const next = params.get("next") ?? "/account";
    return (
      <div className={styles.page}>
        <EmptyState
          title={t("account.alreadySignedIn")}
          body={t("account.alreadySignedIn.body")}
          actionLabel={t("nav.orders")}
          to={next}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div style={{ maxInlineSize: 480, marginInline: "auto", inlineSize: "100%" }}>
        <Panel>
          <SectionTitle>{t("account.signIn")}</SectionTitle>
          <form
            className={styles.form}
            style={{ marginBlockStart: "var(--space-4)" }}
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (!phoneValid || password.length < 8) return;
              void session.signIn(phone.replace(/[\s-]/gu, ""), password).then((ok) => {
                if (ok) navigate(params.get("next") ?? "/account", { replace: true });
              });
            }}
          >
            <Field
              id="signin-phone"
              label={t("account.phone")}
              hint={t("account.phone.hint")}
              error={touched && !phoneValid ? t("account.phone.invalid") : null}
            >
              <Input
                id="signin-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={setPhone}
                describedBy="signin-phone-hint"
                required
              />
            </Field>
            <Field
              id="signin-password"
              label={t("account.password")}
              error={touched && password.length < 8 ? t("account.password.invalid") : null}
            >
              <Input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                required
              />
            </Field>
            {error === null ? null : <p className={styles.notice}>{t.errorMessage(error)}</p>}
            <Button type="submit" fullWidth busy={session.busy}>
              {t("account.signIn")}
            </Button>
          </form>
          <p className={styles.muted} style={{ marginBlockStart: "var(--space-4)" }}>
            {t("account.noAccount")}{" "}
            <Link to="/app" style={{ textDecoration: "underline" }}>
              {t("page.app.title")}
            </Link>
          </p>
        </Panel>
      </div>
    </div>
  );
}

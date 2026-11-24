/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The console's door.
 *
 * A phone number and a password, because that is what the auth route authenticates for staff as
 * well as customers. There is no "remember me": a staff session ends with the tab, which is the
 * behaviour an operations terminal in a shared room should have.
 */

import { useState, type FormEvent, type ReactNode } from "react";

import { Button, Card, Field, Input } from "../components/kit.tsx";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";

/** Sign in as a reviewer. */
export function SignInPage(): ReactNode {
  const t = useT();
  const session = useSession();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const phoneDigits = phone.replace(/[\s-]/gu, "");
  const phoneValid = /^\+?8801[3-9]\d{8}$/u.test(phoneDigits) || /^01[3-9]\d{8}$/u.test(phoneDigits);
  const passwordValid = password.length >= 8;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setLocalError(null);
    if (!phoneValid || !passwordValid) return;
    void session.signIn(phoneDigits, password);
  };

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: "var(--space-4)" }}>
      <div style={{ width: "min(100%, 420px)", display: "grid", gap: "var(--space-4)" }}>
        <div>
          <h1 style={{ fontSize: "var(--type-display-sm-size)", letterSpacing: "-0.02em" }}>Undal</h1>
          <p style={{ color: "var(--color-text-secondary)" }}>{t("admin.title")}</p>
        </div>
        <Card>
          <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-4)" }}>
            <Field id="admin-phone" label={t("account.phone")}>
              <Input id="admin-phone" type="tel" autoComplete="username" value={phone} onChange={setPhone} required />
            </Field>
            {touched && !phoneValid ? <p style={{ color: "var(--color-status-danger)", fontSize: 13 }}>{t("account.phone.invalid")}</p> : null}
            <Field id="admin-password" label={t("account.password")}>
              <Input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
            </Field>
            {touched && !passwordValid ? <p style={{ color: "var(--color-status-danger)", fontSize: 13 }}>{t("account.password.invalid")}</p> : null}
            {localError === null ? null : <p style={{ color: "var(--color-status-danger)", fontSize: 13 }}>{localError}</p>}
            {session.error === null ? null : (
              <p role="alert" style={{ color: "var(--color-status-danger)", fontSize: 13 }}>
                {t.errorMessage(session.error)}
              </p>
            )}
            <Button type="submit" busy={session.busy}>
              {t("account.signIn")}
            </Button>
          </form>
        </Card>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{t("admin.gate.body")}</p>
      </div>
    </main>
  );
}

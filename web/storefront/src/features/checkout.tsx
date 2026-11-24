/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Checkout: address, fulfilment, quote, place.
 *
 * The web can only deliver to a coordinate, and the only trustworthy way for a browser to learn one
 * is the Geolocation API — there is no address lookup in the free-tier budget and a guessed
 * coordinate produces a wrong fare. So delivery asks for the location it needs, explains why, and
 * when permission is refused it offers pickup rather than a dead end. The quote is fetched from
 * the server before anything is placed: what the customer agrees to is what the platform charges.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, Link } from "react-router";

import { ApiError, placeOrder, quoteCart, type Quote, toApiError } from "../lib/api.ts";
import { useCart, subtotalPaisa } from "../lib/cart.ts";
import { useT } from "../lib/locale.tsx";
import { useSession } from "../lib/session.ts";
import { Money } from "../components/Money.tsx";
import { Button, Divider, Field, Input, Panel, SectionTitle, TextArea } from "../components/ui.tsx";
import { EmptyState, ErrorState } from "../components/states.tsx";
import { WarningIcon } from "../components/icons.tsx";
import styles from "./feature.module.css";

/** The tip options, in paisa. Presets rather than a free field: integer arithmetic, no rounding rows. */
const TIPS = [0, 2_000, 5_000, 10_000] as const;

/** The checkout page. */
export function CheckoutPage(): ReactNode {
  const t = useT();
  const navigate = useNavigate();
  const cart = useCart();
  const session = useSession();
  const [fulfilment, setFulfilment] = useState<"DELIVERY" | "PICKUP">(cart.fulfilment);
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [tipPaisa, setTipPaisa] = useState<number>(0);
  const [note, setNote] = useState("");
  const [instructions, setInstructions] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (session.status === "unknown") void session.restore();
  }, [session]);

  useEffect(() => {
    if (cart.lines.length === 0 || cart.vendor === null) return;
    if (fulfilment === "DELIVERY" && point === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const priced = await quoteCart({
          vendorId: cart.vendor?.id ?? "",
          fulfilment,
          ...(point === null ? {} : { deliveryPoint: point }),
          items: cart.lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            modifiers: line.modifiers.map((modifier) => modifier.id),
            note: line.note,
          })),
          tipPaisa,
        });
        if (!cancelled) {
          setQuote(priced);
          setError(null);
        }
      } catch (failure) {
        if (!cancelled) setError(toApiError(failure));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cart.lines, cart.vendor, fulfilment, point, tipPaisa]);

  if (cart.lines.length === 0) {
    return (
      <div className={styles.page}>
        <EmptyState title={t("cart.empty.title")} body={t("cart.empty.body")} actionLabel={t("cart.empty.action")} to="/" />
      </div>
    );
  }

  if (session.status !== "signed-in") {
    return (
      <div className={styles.page}>
        <EmptyState
          title={t("account.signInRequired")}
          body={t("checkout.signInBody")}
          actionLabel={t("account.signIn")}
          to={`/sign-in?next=${encodeURIComponent("/checkout")}`}
        />
      </div>
    );
  }

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoError(t("checkout.location.unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
        setGeoError(null);
      },
      (failure) => setGeoError(failure.code === failure.PERMISSION_DENIED ? t("checkout.location.denied") : t("checkout.location.failed")),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  const submit = async () => {
    if (quote === null) return;
    setPlacing(true);
    setError(null);
    try {
      const placed = await placeOrder({
        quoteToken: quote.quoteToken,
        customerNote: note.trim() === "" ? null : note.trim(),
        ...(point === null ? {} : { deliveryPoint: point }),
      });
      cart.clear();
      navigate(`/o/${placed.order.code}`, { replace: true });
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.twoColumn}>
        <div className={styles.form}>
          <Panel>
            <SectionTitle
              action={
                <div className={styles.segmented} role="group" aria-label={t("checkout.fulfilment")}>
                  {(["DELIVERY", "PICKUP"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={styles.segment}
                      aria-pressed={fulfilment === mode}
                      onClick={() => {
                        setFulfilment(mode);
                        setQuote(null);
                      }}
                    >
                      {mode === "DELIVERY" ? t("checkout.delivery") : t("checkout.pickup")}
                    </button>
                  ))}
                </div>
              }
            >
              {t("checkout.fulfilment")}
            </SectionTitle>

            {fulfilment === "DELIVERY" ? (
              <div className={styles.form} style={{ marginBlockStart: "var(--space-4)" }}>
                {point === null ? (
                  <div className={styles.notice}>
                    <WarningIcon size={20} />
                    <span>{t("checkout.location.why")}</span>
                  </div>
                ) : (
                  <p className={styles.muted}>
                    {t("checkout.location.set", {
                      lat: point.lat.toFixed(4),
                      lon: point.lon.toFixed(4),
                    })}
                  </p>
                )}
                {geoError === null ? null : <p className={styles.notice}>{geoError}</p>}
                <Button variant="secondary" onClick={requestLocation}>
                  {point === null ? t("checkout.location.use") : t("checkout.location.update")}
                </Button>
                <Field id="checkout-instructions" label={t("checkout.instructions")} hint={t("checkout.instructions.hint")}>
                  <Input id="checkout-instructions" value={instructions} onChange={setInstructions} />
                </Field>
              </div>
            ) : (
              <p className={styles.muted} style={{ marginBlockStart: "var(--space-4)" }}>
                {t("checkout.pickup.note", { vendor: cart.vendor?.name ?? "" })}
              </p>
            )}
          </Panel>

          <Panel>
            <SectionTitle>{t("checkout.tip")}</SectionTitle>
            <div className={styles.chips} style={{ marginBlockStart: "var(--space-3)" }}>
              {TIPS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={styles.chip ?? ""}
                  aria-pressed={tipPaisa === amount}
                  onClick={() => setTipPaisa(amount)}
                  style={{
                    minHeight: "var(--layout-tap-target-min)",
                    paddingInline: "var(--space-4)",
                    borderRadius: "var(--radius-full)",
                    background: tipPaisa === amount ? "var(--color-action-primary-soft)" : "var(--color-bg-surface)",
                    fontWeight: 600,
                  }}
                >
                  {amount === 0 ? t("checkout.tip.none") : t.money(amount)}
                </button>
              ))}
            </div>
          </Panel>

          <Panel>
            <SectionTitle>{t("checkout.note")}</SectionTitle>
            <div className={styles.form} style={{ marginBlockStart: "var(--space-3)" }}>
              <Field id="checkout-note" label={t("checkout.note.label")} hint={t("checkout.note.hint")}>
                <TextArea id="checkout-note" value={note} onChange={setNote} maxLength={500} />
              </Field>
            </div>
          </Panel>
        </div>

        <aside className={styles.sticky}>
          <Panel>
            <SectionTitle>{t("cart.total")}</SectionTitle>
            <div className={styles.totalRow}>
              <span>{t("cart.subtotal")}</span>
              <Money paisa={subtotalPaisa(cart.lines)} size="sm" />
            </div>
            {quote === null ? (
              <p className={styles.muted}>{t("checkout.quote.pending")}</p>
            ) : (
              <>
                {quote.lines.map((line, index) => (
                  <div key={`${line.kind ?? "line"}-${index}`} className={styles.totalRow}>
                    <span>{line.labelEn ?? line.kind ?? ""}</span>
                    <Money paisa={line.amountPaisa ?? 0} size="sm" />
                  </div>
                ))}
                <Divider />
                <div className={styles.totalRow}>
                  <span>{t("cart.total")}</span>
                  <Money paisa={quote.totalPaisa} size="lg" />
                </div>
                <p className={styles.muted}>
                  {t("checkout.eta", { min: quote.etaMinMinutes, max: quote.etaMaxMinutes })}
                </p>
              </>
            )}
            {error === null ? null : <ErrorState error={error} compact />}
            <Button
              fullWidth
              busy={placing}
              disabled={quote === null || (fulfilment === "DELIVERY" && point === null)}
              onClick={() => void submit()}
            >
              {t("checkout.placeOrder")}
            </Button>
            <p className={styles.muted}>{t("checkout.payment.cod")}</p>
            <Link to="/cart" className={styles.muted}>
              {t("cart.title")}
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

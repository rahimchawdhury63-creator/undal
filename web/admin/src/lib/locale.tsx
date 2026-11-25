/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * Language, as context.
 *
 * The console ships the same two catalogues as the customer app: an operator in Sylhet reads Bangla
 * at 1 am more comfortably than English, and a queue whose reasons are only in English is a queue
 * that gets decided by whoever can read it. The translator is callable so a component writes
 * `t("admin.cash.title")` and still reaches `t.money` and `t.dateTime`.
 */

import { createTranslator, type Locale, type MessageArgs, type MessageKey, type Translator } from "@undal/i18n";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** A translator that is also directly callable. */
export type TFn = Translator & ((key: MessageKey, args?: MessageArgs) => string);

/** Wrap the translator object in a function. */
function callable(base: Translator): TFn {
  const bound = ((key: MessageKey, args?: MessageArgs) => base.t(key, args)) as TFn;
  return Object.assign(bound, base) as TFn;
}

interface LocaleValue {
  readonly locale: Locale;
  readonly t: TFn;
  readonly setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleValue>({
  locale: "bn",
  t: callable(createTranslator("bn")),
  setLocale: () => undefined,
});

/** The console's language provider. The choice is per session, not persisted per person. */
export function AdminLocaleProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [locale, setLocale] = useState<Locale>("bn");
  const value = useMemo<LocaleValue>(() => ({ locale, t: callable(createTranslator(locale)), setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The translator for the console's active language. */
export function useT(): TFn {
  return useContext(LocaleContext).t;
}

/** The active language code. */
export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/** Switch the console's language. */
export function useSetLocale(): (locale: Locale) => void {
  return useContext(LocaleContext).setLocale;
}

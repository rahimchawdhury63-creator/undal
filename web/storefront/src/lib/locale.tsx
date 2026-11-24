/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The translator, as React context.
 *
 * One provider, one translator per locale, and no component ever imports a catalogue directly.
 * That is what makes the prerender pass able to render a Bengali page and an English page from
 * the same tree without a reload, and what makes a missing key a compile error rather than a
 * blank label.
 */

import { createTranslator, type Locale, type MessageArgs, type MessageKey, type Translator } from "@undal/i18n";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { usePrefs } from "./prefs.ts";

/** A translator that is also directly callable: `t("key")` and `t.money(paisa)` both work. */
export type TFn = Translator & ((key: MessageKey, args?: MessageArgs) => string);

/** Wrap the translator object in a function so components read `t("cart.title")`. */
function callable(base: Translator): TFn {
  const bound = ((key: MessageKey, args?: MessageArgs) => base.t(key, args)) as TFn;
  return Object.assign(bound, base) as TFn;
}

const LocaleContext = createContext<{ readonly locale: Locale; readonly t: TFn }>({
  locale: "bn",
  t: callable(createTranslator("bn")),
});

/** Provide the active locale to the tree. */
export function LocaleProvider({ children, locale }: { readonly children: ReactNode; readonly locale?: Locale }): ReactNode {
  const preferred = usePrefs((state) => state.locale);
  const active = locale ?? preferred;
  const value = useMemo(() => ({ locale: active, t: callable(createTranslator(active)) }), [active]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The translator for the active locale. */
export function useT(): TFn {
  return useContext(LocaleContext).t;
}

/** The active locale code, for `lang` attributes and numeral choices. */
export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/**
 * Pick the right side of a bilingual field.
 *
 * Bangla falls back to English when the kitchen has not written a Bengali name, which is better
 * than an empty heading; the reverse never happens because Bangla is the primary language.
 */
export function pick(locale: Locale, en: string | null | undefined, bn: string | null | undefined): string {
  if (locale === "bn") return bn ?? en ?? "";
  return en ?? bn ?? "";
}

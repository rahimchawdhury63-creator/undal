/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Language, theme and area: the three choices a visitor makes about the platform itself.
 *
 * They live in one store because they are read together on every page — the `<html lang>`, the
 * `data-theme` attribute and the default area filter — and persisted together so a returning
 * visitor does not re-answer the same three questions.
 */

import { isLocale, type Locale } from "@undal/i18n";
import { create } from "zustand";

/** How the surface chooses light or dark. `system` follows the device and is the default. */
export type ThemeChoice = "light" | "dark" | "system";

/** The visitor's standing preferences. */
export interface PrefsState {
  readonly locale: Locale;
  readonly theme: ThemeChoice;
  /** The area slug the storefront defaults to, or `null` before one is chosen. */
  readonly area: string | null;
  setLocale(locale: Locale): void;
  setTheme(theme: ThemeChoice): void;
  setArea(area: string | null): void;
  /** Apply the stored choices to the document; called once on boot and on every change. */
  apply(): void;
}

const KEY = "undal.prefs.v1";

interface Stored {
  readonly locale?: string;
  readonly theme?: string;
  readonly area?: string;
}

function read(): Stored {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? {} : (JSON.parse(raw) as Stored);
  } catch {
    return {};
  }
}

/** The locale the URL asks for, if it asks. A shared `/r/x?lang=en` link wins over a stored choice. */
function localeFromUrl(): Locale | null {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("lang");
  return isLocale(requested) ? requested : null;
}

const stored = read();

/**
 * The preference store. Apply it once on boot; every setter applies the change itself.
 */
export const usePrefs = create<PrefsState>((set, get) => ({
  locale: localeFromUrl() ?? (isLocale(stored.locale) ? stored.locale : "bn"),
  theme: stored.theme === "light" || stored.theme === "dark" || stored.theme === "system" ? stored.theme : "system",
  area: typeof stored.area === "string" ? stored.area : null,

  setLocale(locale) {
    set({ locale });
    get().apply();
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", locale);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  },

  setTheme(theme) {
    set({ theme });
    get().apply();
  },

  setArea(area) {
    set({ area });
    get().apply();
  },

  apply() {
    if (typeof document === "undefined") return;
    const state = get();
    document.documentElement.setAttribute("data-theme", state.theme);
    document.documentElement.setAttribute("lang", state.locale);
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ locale: state.locale, theme: state.theme, area: state.area }));
    } catch {
      // Preference persistence is a convenience, never a requirement.
    }
  },
}));

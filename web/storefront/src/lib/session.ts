/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The customer's session.
 *
 * The access token lives in memory for the life of the tab; the refresh token is kept in
 * `sessionStorage` so a reload does not sign a customer out mid-checkout. That is a deliberate,
 * documented compromise: the corpus wants the refresh token in an `HttpOnly` cookie, and the API
 * currently returns it in the body. `sessionStorage` at least dies with the tab, and the token
 * pair rotates on every refresh, so a stolen copy is worth one use.
 */

import { create } from "zustand";

import { ApiError, refreshSession, signIn as signInRequest, signOut as signOutRequest, whoAmI, type SessionUser } from "./api.ts";

const KEY = "undal.session.v1";

interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** What the app sees of the session. `status` drives the header's sign-in affordance. */
export interface SessionState {
  readonly status: "unknown" | "anonymous" | "signed-in";
  readonly user: SessionUser | null;
  readonly error: string | null;
  readonly busy: boolean;
  signIn(phone: string, password: string): Promise<boolean>;
  restore(): Promise<void>;
  refresh(): Promise<boolean>;
  signOut(): Promise<void>;
  /** The current access token, or `null`. */
  token(): string | null;
}

function readStored(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // A browser with storage disabled still gets a working in-memory session.
  }
}

let current: StoredSession | null = readStored();

export const useSession = create<SessionState>((set, get) => ({
  status: current === null ? "anonymous" : "unknown",
  user: null,
  error: null,
  busy: false,

  token() {
    return current?.accessToken ?? null;
  },

  async signIn(phone, password) {
    set({ busy: true, error: null });
    try {
      const issued = await signInRequest({ phone, password });
      current = { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
      writeStored(current);
      const user = await whoAmI({ token: issued.accessToken });
      set({ status: "signed-in", user, busy: false, error: null });
      return true;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "NETWORK";
      set({ status: "anonymous", user: null, busy: false, error: code });
      return false;
    }
  },

  async restore() {
    if (current === null) {
      set({ status: "anonymous", user: null });
      return;
    }
    try {
      const user = await whoAmI({ token: current.accessToken });
      set({ status: "signed-in", user });
    } catch {
      // An expired access token is expected; the refresh token is the one that matters.
      const refreshed = await get().refresh();
      if (!refreshed) set({ status: "anonymous", user: null });
    }
  },

  async refresh() {
    const stored = current;
    if (stored === null) return false;
    try {
      const issued = await refreshSession(stored.refreshToken);
      current = { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
      writeStored(current);
      const user = await whoAmI({ token: issued.accessToken });
      set({ status: "signed-in", user });
      return true;
    } catch {
      current = null;
      writeStored(null);
      set({ status: "anonymous", user: null });
      return false;
    }
  },

  async signOut() {
    const token = current?.accessToken ?? null;
    try {
      if (token !== null) await signOutRequest({ token });
    } catch {
      // Signing out locally must succeed even when the network does not.
    }
    current = null;
    writeStored(null);
    set({ status: "anonymous", user: null, error: null });
  },
}));

/** The access token outside React, for a loader that runs before any component. */
export function accessToken(): string | null {
  return current?.accessToken ?? null;
}

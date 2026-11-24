/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The reviewer's session.
 *
 * Staff sessions are shorter-lived than a customer's and are expected to end with the tab, so the
 * refresh token lives in `sessionStorage` and the access token only in memory. The role is kept
 * beside the token not to guard screens — the server is the guard, and every route re-checks the
 * permission — but so the console can hide an action the account cannot perform rather than offer
 * a button whose only outcome is a `403`.
 */

import { create } from "zustand";

import { ApiError, login as loginRequest, logout as logoutRequest, refresh as refreshRequest, toApiError, whoAmI, type AdminUser } from "./api.ts";

const KEY = "undal.admin.session.v1";

interface Stored {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** What the console knows about the person at the keyboard. */
export interface SessionState {
  readonly status: "unknown" | "anonymous" | "signed-in";
  readonly user: AdminUser | null;
  readonly error: string | null;
  readonly busy: boolean;
  signIn(phone: string, password: string): Promise<boolean>;
  restore(): Promise<void>;
  signOut(): Promise<void>;
  /** The current access token, or `null` when there is no session. */
  token(): string | null;
}

/** A coarse device fingerprint: enough for the session list, no tracking beyond it. */
function fingerprint(): string {
  if (typeof navigator === "undefined") return "undal-admin-prerender";
  return [navigator.userAgent, navigator.language, `${window.screen.width}x${window.screen.height}`].join("|");
}

function readStored(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // A browser that refuses storage still gets a working in-memory session.
  }
}

let current: Stored | null = readStored();

/** The reviewer's session store. */
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
      const pair = await loginRequest(phone, password, fingerprint());
      current = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
      writeStored(current);
      const user = await whoAmI(pair.accessToken);
      set({ status: "signed-in", user, busy: false, error: null });
      return true;
    } catch (failure) {
      set({ status: "anonymous", user: null, busy: false, error: toApiError(failure).code });
      return false;
    }
  },

  async restore() {
    if (current === null) {
      set({ status: "anonymous", user: null });
      return;
    }
    try {
      const user = await whoAmI(current.accessToken);
      set({ status: "signed-in", user });
      return;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status !== 401) {
        set({ status: "anonymous", user: null, error: failure.code });
        return;
      }
    }
    try {
      const pair = await refreshRequest(current.refreshToken);
      current = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
      writeStored(current);
      const user = await whoAmI(pair.accessToken);
      set({ status: "signed-in", user });
    } catch (failure) {
      current = null;
      writeStored(null);
      set({ status: "anonymous", user: null, error: toApiError(failure).code });
    }
  },

  async signOut() {
    const token = get().token();
    try {
      if (token !== null) await logoutRequest(token);
    } catch {
      // Leaving the console must work even when the network does not.
    }
    current = null;
    writeStored(null);
    set({ status: "anonymous", user: null, error: null });
  },
}));

/** The access token outside React, for a fetch that starts before a render. */
export function accessToken(): string | null {
  return current?.accessToken ?? null;
}

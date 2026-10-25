"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase-browser";

export type Me = {
  email: string; plan: "free" | "pro"; usage: Record<string, number>; limits: Record<string, number>;
  billingEnabled: boolean; hasProfile: boolean; name: string; monthStart: string;
};

type Ctx = {
  session: Session;
  me: Me | null;
  refreshMe: () => Promise<void>;
  api: <T = any>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
  toast: (msg: string, bad?: boolean) => void;
  signOut: () => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

export function AppProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [toastMsg, setToast] = useState<{ m: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const tokenRef = useRef(session.access_token);
  tokenRef.current = session.access_token;

  const api = useCallback(async <T,>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
    const { json, ...rest } = init;
    const headers: Record<string, string> = { ...(rest.headers as Record<string, string> || {}), Authorization: `Bearer ${tokenRef.current}` };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
    let j: any = {};
    try { j = await r.json(); } catch { /* empty body */ }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j as T;
  }, []);

  const toast = useCallback((m: string, bad = false) => {
    setToast({ m, bad }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshMe = useCallback(async () => { try { setMe(await api<Me>("/api/me")); } catch (e: any) { toast(e.message, true); } }, [api, toast]);
  useEffect(() => { refreshMe(); }, [refreshMe]);

  const signOut = useCallback(async () => { await browserClient().auth.signOut(); }, []);

  return (
    <AppCtx.Provider value={{ session, me, refreshMe, api, toast, signOut }}>
      {children}
      {toastMsg && <div className={`toast ${toastMsg.bad ? "bad" : ""}`} role="status" aria-live="polite">{toastMsg.m}</div>}
    </AppCtx.Provider>
  );
}

/** Run an async action with a busy flag and toast on error. */
export function useBusy() {
  const { toast } = useApp();
  const [busy, setBusy] = useState("");
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e: any) { toast(e?.message || "Something went wrong", true); } finally { setBusy(""); }
  }, [toast]);
  return { busy, run };
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { Alert, Button, Chip, Field, Icon, Skeleton } from "./ui";

/** Shared client auth: Supabase session + an authed fetch helper for our API routes. */
export function useAuth() {
  const supabase = useMemo(() => browserClient(), []);
  const [session, setSession] = useState<any>(undefined); // undefined = loading, null = signed out
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const token = session?.access_token;
  const api = useCallback(async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const headers: Record<string, string> = { ...((rest.headers as Record<string, string>) || {}), Authorization: `Bearer ${token}` };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }, [token]);

  return { supabase, session, api };
}
export type Auth = ReturnType<typeof useAuth>;

function SignIn({ supabase }: { supabase: ReturnType<typeof browserClient> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card stack" style={{ width: "100%", maxWidth: 400, padding: 28 }}>
        <div className="brand" style={{ padding: 0 }}><span className="logo">A</span>ApplyPilot</div>
        <div>
          <h2>Sign in</h2>
          <p className="muted sm" style={{ marginTop: 4 }}>
            {usePassword ? "Sign in with your email and password." : "We'll email you a magic link. No password needed."}
          </p>
        </div>
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setMsg(null);
          if (usePassword) {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            setBusy(false);
            if (error) setMsg({ tone: "bad", text: error.message });
          } else {
            const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
            setBusy(false);
            setMsg(error ? { tone: "bad", text: error.message } : { tone: "ok", text: "Check your email for the sign-in link." });
          }
        }}>
          <Field label="Email"><input type="email" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {usePassword && (
            <Field label="Password"><input type="password" required placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          )}
          <Button variant="primary" loading={busy} type="submit">{usePassword ? "Sign in" : "Email me a link"}</Button>
        </form>
        <button type="button" className="btn ghost sm" onClick={() => { setUsePassword(!usePassword); setMsg(null); }}>
          {usePassword ? "Use a magic link instead" : "Sign in with password"}
        </button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </main>
  );
}

const LINKS = [
  ["/dashboard", "Dashboard", "home"], ["/feed", "Jobs", "briefcase"], ["/ats", "ATS check", "check"],
  ["/tailor", "Tailor resume", "doc"], ["/outreach", "Super Apply", "send"], ["/tracker", "Tracker", "board"]
] as const;

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("ap-theme") as "light" | "dark" | null;
    const t = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(t); document.documentElement.dataset.theme = t;
  }, []);
  const toggle = () => { const t = theme === "dark" ? "light" : "dark"; setTheme(t); localStorage.setItem("ap-theme", t); document.documentElement.dataset.theme = t; };
  return { theme, toggle };
}

function NavLinks({ path }: { path: string }) {
  return <>{LINKS.map(([href, label, icon]) => (
    <Link key={href} href={href} className={`navlink ${path === href ? "active" : ""}`}><Icon name={icon} />{label}</Link>
  ))}</>;
}

/** App shell: sidebar (desktop) / scrolling top nav (mobile), topbar with usage, alerts bell and theme toggle. */
export function Page({ title, sub, actions, usage, children, auth }:
  { title: string; sub?: string; actions?: React.ReactNode; usage?: string; children: React.ReactNode; auth: Auth }) {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [unread, setUnread] = useState(0);
  const signedIn = !!auth.session;
  const { api } = auth;
  useEffect(() => { if (signedIn) api("/api/notifications?unread=true").then((j) => setUnread(j.unread || 0)).catch(() => {}); }, [signedIn, api]);

  if (auth.session === undefined) return (
    <div className="shell"><aside className="sidebar"><Skeleton h={30} w={140} /></aside>
      <div className="main"><div className="content stack"><Skeleton h={30} w={240} /><Skeleton h={160} /><Skeleton h={220} /></div></div></div>
  );
  if (!auth.session) return <SignIn supabase={auth.supabase} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand"><span className="logo">A</span>ApplyPilot</Link>
        <NavLinks path={path} />
        <div className="spacer" />
        <div className="muted xs truncate" style={{ padding: "0 12px 8px" }}>{auth.session.user?.email}</div>
        <button className="navlink btn ghost" style={{ justifyContent: "flex-start" }} onClick={() => auth.supabase.auth.signOut()}><Icon name="logout" />Sign out</button>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link href="/" className="brand mobile-brand"><span className="logo" style={{ width: 26, height: 26, fontSize: 13 }}>A</span>ApplyPilot</Link>
          <div className="grow" />
          {usage && <UsageBadge api={api} feature={usage} />}
          <Link href="/feed#alerts" className="btn icon ghost" aria-label="Job alerts" style={{ position: "relative" }}>
            <Icon name="bell" />{unread > 0 && <span style={{ position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 99, background: "var(--accent)", color: "var(--accent-fg)", fontSize: 10, fontWeight: 800, display: "grid", placeItems: "center", padding: "0 4px" }}>{unread}</span>}
          </Link>
          <button className="btn icon ghost" onClick={toggle} aria-label="Toggle dark mode"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
        </header>
        <nav className="mobile-nav"><NavLinks path={path} /></nav>
        <main className="content">
          <div className="page-head">
            <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
            {actions && <div className="row">{actions}</div>}
          </div>
          <div className="stack-lg">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function UsageBadge({ api, feature }: { api: (p: string) => Promise<any>; feature: string }) {
  const [u, setU] = useState<{ used: number; limit: number | null; label: string } | null>(null);
  useEffect(() => { api("/api/usage").then((j) => setU(j.features.find((f: any) => f.feature === feature) || null)).catch(() => {}); }, [api, feature]);
  if (!u) return <Skeleton h={24} w={150} r={99} />;
  if (u.limit === null) return <Chip tone="accent">Pro · unlimited</Chip>;
  const left = Math.max(0, u.limit - u.used);
  return <Chip tone={left === 0 ? "bad" : left <= 1 ? "warn" : "accent"}>{left} of {u.limit} {u.label} left</Chip>;
}

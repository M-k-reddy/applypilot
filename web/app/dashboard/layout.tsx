"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient, supabaseConfigured } from "@/lib/supabase-browser";
import { AppProvider, useApp } from "@/components/AppContext";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";

const NAV = [
  { href: "/dashboard", label: "Overview", i: "◧" },
  { href: "/dashboard/profile", label: "Profile", i: "☺" },
  { href: "/dashboard/jobs", label: "Jobs", i: "⌕" },
  { href: "/dashboard/tailor", label: "Tailor", i: "⇄" },
  { href: "/dashboard/tracker", label: "Tracker", i: "▦" },
  { href: "/dashboard/auto", label: "Auto-apply", i: "↻" },
  { href: "/dashboard/extension", label: "Extension", i: "⚡" },
  { href: "/dashboard/billing", label: "Billing", i: "₹" }
];

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { me, signOut } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/dashboard" ? path === href : path?.startsWith(href));

  return (
    <div className="app">
      <div className="mobile-bar">
        <Logo href="/dashboard" />
        <button className="btn btn-icon" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>☰</button>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Dashboard">
        <Logo href="/dashboard" />
        <nav className="stack" style={{ gap: 2 }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="side-link" aria-current={active(n.href) ? "page" : undefined}>
              <span className="i" aria-hidden="true">{n.i}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <div className="row between">
            <span className={`badge ${me?.plan === "pro" ? "badge-brand" : ""}`}>{me ? (me.plan === "pro" ? "Pro" : "Free plan") : "…"}</span>
            <ThemeToggle />
          </div>
          <div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{me?.email}</div>
          <button className="btn btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main id="main" className="main">{children}</main>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const [password, setPassword] = useState("");
  const [usePw, setUsePw] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr("Enter a valid email address."); setState("error"); return; }
    setState("sending"); setErr("");
    if (usePw) {
      const { error } = await browserClient().auth.signInWithPassword({ email, password });
      if (error) { setErr(error.message); setState("error"); } else setState("idle");
      return;
    }
    const { error } = await browserClient().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + "/dashboard" } });
    if (error) { setErr(error.message); setState("error"); } else setState("sent");
  };
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo />
        <h1 style={{ fontSize: "1.7rem", marginTop: 22 }}>Sign in to ApplyPilot</h1>
        <p className="muted">We will email you a secure sign-in link. No password needed.</p>
        {!supabaseConfigured && <div className="alert alert-warn" style={{ marginBottom: 14 }}>Supabase is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</div>}
        {state === "sent" ? (
          <div className="alert alert-ok">Check <b>{email}</b> for your sign-in link. You can close this tab.</div>
        ) : (
          <form onSubmit={send} className="stack">
            <label className="field"><span>Email</span>
              <input className="input" type="email" autoComplete="email" placeholder="you@college.edu.in" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            {usePw && <label className="field"><span>Password</span>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>}
            {state === "error" && <div className="alert alert-bad" role="alert">{err}</div>}
            <button className="btn btn-primary btn-lg" disabled={state === "sending"}>{state === "sending" ? <><span className="spinner" /> {usePw ? "Signing in…" : "Sending…"}</> : usePw ? "Sign in" : "Email me a sign-in link"}</button>
            <button type="button" className="btn" onClick={() => { setUsePw(!usePw); setState("idle"); setErr(""); }}>{usePw ? "Email me a link instead" : "Sign in with password"}</button>
          </form>
        )}
        <p className="tiny muted" style={{ marginTop: 18 }}>Free plan, no card needed. <Link href="/">Back to home</Link></p>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const sb = browserClient();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="auth-wrap"><span className="spinner" aria-label="Loading" /></div>;
  if (!session) return <SignIn />;
  return <AppProvider session={session}><Shell>{children}</Shell></AppProvider>;
}

"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Page, useAuth } from "@/components/auth";
import { JobCard } from "@/components/JobCard";
import { Alert, Button, Card, Chip, CopyButton, Empty, Icon, Progress, Skeleton, SkeletonJob } from "@/components/ui";

declare global { interface Window { Razorpay: any } }

const NEXT: [string, string, string, string][] = [
  ["/ats", "check", "Run an ATS check", "Score your resume and get a fix for every miss."],
  ["/feed", "briefcase", "Browse today's jobs", "Fresh roles ranked by how well you match."],
  ["/outreach", "send", "Reach the hiring team", "Find HR and draft a referral note."]
];

export default function Dashboard() {
  const auth = useAuth();
  const { supabase, session, api } = auth;
  const [profile, setProfile] = useState<any>(undefined);
  const [usage, setUsage] = useState<any>(null);
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [extToken, setExtToken] = useState("");

  useEffect(() => {
    if (!session) return;
    supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data }) => setProfile(data || null));
    supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(20).then(async ({ data }) => {
      const list = data || [];
      if (list.length) {
        // free, deterministic match score for every card
        const { scores } = await api("/api/match", { method: "POST", json: { quick: true, jobIds: list.map((j: any) => j.id) } }).catch(() => ({ scores: {} }));
        setJobs(list.map((j: any) => ({ ...j, match: scores[j.id] || j.match })));
      } else setJobs([]);
    });
    api("/api/usage").then(setUsage).catch(() => {});
  }, [session, supabase, api]);

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setErr(""); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(""); } };

  const upload = (f: File) => run("upload", async () => {
    const fd = new FormData(); fd.append("file", f);
    const j = await api("/api/resume", { method: "POST", body: fd });
    setProfile((p: any) => ({ ...p, profile_json: j.profile }));
  });

  const upgrade = () => run("upgrade", async () => {
    const { subscriptionId, keyId } = await api("/api/billing/subscribe", { method: "POST" });
    await new Promise<void>((res) => { const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = () => res(); document.body.appendChild(s); });
    new window.Razorpay({ key: keyId, subscription_id: subscriptionId, name: "ApplyPilot Pro", handler: () => alert("Payment received. Pro unlocks in a few seconds.") }).open();
  });

  const p = profile?.profile_json;
  const pro = profile?.plan === "pro";
  const first = p?.full_name?.split(" ")[0];

  return (
    <Page title={first ? `Welcome back, ${first}` : "Dashboard"} sub="Your resume, this month's usage and the jobs you're working on." auth={auth}
      actions={profile && !pro ? <Button variant="primary" icon="bolt" loading={busy === "upgrade"} onClick={upgrade}>Upgrade · ₹149/mo</Button> : profile ? <Chip tone="accent">Pro</Chip> : null}>
      {err && <Alert>{err}</Alert>}

      <div className="grid grid-main">
        <Card title="Resume" sub={p ? "Parsed into your reusable profile." : "Upload a PDF to unlock matching, tailoring and autofill."}>
          {profile === undefined ? <div className="stack"><Skeleton h={18} w="50%" /><Skeleton h={14} w="80%" /></div> : p ? (
            <div className="stack">
              <div className="row" style={{ gap: 16 }}>
                <span className="logo" style={{ width: 48, height: 48, borderRadius: 14, fontSize: 18 }}>{(p.full_name || "?")[0]}</span>
                <div className="grow"><b>{p.full_name}</b><div className="muted sm">{p.headline || p.email}</div></div>
              </div>
              <div className="chips">{(p.skills || []).slice(0, 10).map((s: string) => <span key={s} className="chip outline">{s}</span>)}</div>
              <div className="row">
                <label className="btn sm" style={{ cursor: "pointer" }}><Icon name="upload" size={14} />{busy === "upload" ? "Parsing…" : "Replace PDF"}
                  <input type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
              </div>
            </div>
          ) : (
            <label className="empty" style={{ cursor: "pointer" }}>
              <div className="icon"><Icon name="upload" /></div>
              <h4>{busy === "upload" ? "Parsing your resume…" : "Upload your resume"}</h4>
              <p className="sm">PDF, up to 5 MB. We never invent anything that isn't on it.</p>
              <input type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          )}
        </Card>

        <Card title="This month" sub={pro ? "Pro · unlimited" : "Free plan limits reset on the 1st."}>
          {!usage ? <div className="stack"><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div> : (
            <div className="stack" style={{ gap: 16 }}>
              {usage.features.filter((f: any) => ["ats", "tailor", "autofill", "outreach", "find_hr"].includes(f.feature)).map((f: any) => (
                <div key={f.feature}>
                  <div className="row between sm"><span>{f.label[0].toUpperCase() + f.label.slice(1)}</span><span className="muted">{f.limit === null ? `${f.used}` : `${f.used} / ${f.limit}`}</span></div>
                  {f.limit !== null && <div style={{ marginTop: 8 }}><Progress value={(f.used / f.limit) * 100} tone={f.used >= f.limit ? "bad" : "accent"} /></div>}
                </div>))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-3">
        {NEXT.map(([href, icon, t, d]) => (
          <Link key={href} href={href} className="feature" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="icon"><Icon name={icon} /></div><h4>{t}</h4><p>{d}</p>
          </Link>))}
      </div>

      <section className="stack">
        <div className="row between"><h3>Your jobs</h3><Link href="/feed" className="btn sm ghost">Browse feed →</Link></div>
        {jobs === null ? <><SkeletonJob /><SkeletonJob /></>
          : jobs.length === 0 ? <Empty icon="briefcase" title="No jobs yet" action={<Link href="/feed" className="btn">Open the job feed</Link>}>Jobs you score, tailor or save will appear here with their match score.</Empty>
          : jobs.map((j) => <JobCard key={j.id} j={j} api={api} />)}
      </section>

      <Card title="Chrome extension" sub="Generate a token once and paste it into the extension settings with your API URL. It keeps itself signed in.">
        <div className="stack" style={{ gap: 8 }}>
          {extToken ? <><code className="token">{extToken}</code><div><CopyButton text={extToken} label="Copy token" /></div></>
            : <div><Button onClick={() => run("ext", async () => { const r = await api("/api/extension/connect", { method: "POST", json: {} }); setExtToken(r.token); })} disabled={busy === "ext"}>{busy === "ext" ? "Generating…" : "Generate extension token"}</Button></div>}
        </div>
      </Card>
    </Page>
  );
}

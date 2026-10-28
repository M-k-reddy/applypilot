"use client";
import { useEffect, useState } from "react";
import { Page, UsageBadge, useAuth } from "@/components/auth";
import { Alert, Button, Card, Chip, CopyButton, Empty, Field, Icon, Skeleton } from "@/components/ui";

// Defined outside the page so inputs inside keep focus across re-renders.
function Step({ n, title, sub, usage, api, children }: { n: number; title: string; sub: string; usage: string; api: (p: string) => Promise<any>; children: React.ReactNode }) {
  return <Card title={<span className="row" style={{ gap: 12 }}><span className="step-num">{n}</span>{title}</span>} sub={sub} action={<UsageBadge api={api} feature={usage} />}>{children}</Card>;
}

export default function OutreachPage() {
  const auth = useAuth();
  const [ref, setRef] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(""); const [company, setCompany] = useState(""); const [jd, setJd] = useState("");
  const [domain, setDomain] = useState(""); const [people, setPeople] = useState("");
  const [hr, setHr] = useState<any>(null); const [to, setTo] = useState("");
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const r: Record<string, string> = {};
    ["jobId", "feedJobId"].forEach((k) => { const v = p.get(k); if (v) r[k] = v; });
    setRef(r);
    if (p.get("company")) setCompany(p.get("company")!);
    if (p.get("people")) setPeople(p.get("people")!);
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setErr(""); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(""); } };
  const names = () => people.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const jobBody = () => (Object.keys(ref).length ? ref : { job: { title, company, description: jd } });

  const findHr = () => run("hr", async () => {
    const j = await auth.api("/api/find-hr", { method: "POST", json: { domain, company, people: names() } });
    setHr(j); if (!domain && j.domain) setDomain(j.domain);
    setTo(j.published?.find((e: any) => e.kind === "hiring")?.email || "");
  });
  const write = () => run("write", async () => {
    setOut(await auth.api("/api/outreach", { method: "POST", json: { ...jobBody(), recipient: { name: names()[0], email: to || undefined } } }));
  });
  const mailto = out ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(out.email_subject)}&body=${encodeURIComponent(out.email_body)}` : "";
  const fromFeed = Object.keys(ref).length > 0;

  return (
    <Page title="Super Apply" sub="Find who's hiring, then send a short, specific note. Nothing is sent for you." auth={auth}>
      {err && <Alert>{err}</Alert>}

      <Card title="Job" sub={fromFeed ? "Using the job you picked from the feed." : "Paste the role you're reaching out about."}>
        {fromFeed ? <Chip tone="accent">Job selected from your feed</Chip> : <div className="stack">
          <div className="grid grid-2">
            <Field label="Role"><input placeholder="e.g. Software Engineer" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Company"><input placeholder="e.g. Razorpay" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
          </div>
          <Field label="Job description"><textarea rows={5} placeholder="Paste the job description" value={jd} onChange={(e) => setJd(e.target.value)} /></Field>
        </div>}
      </Card>

      <Step n={1} title="Find the hiring contact" sub="Free: we read the company's own public pages and check its mail server. No paid lookups." usage="find_hr" api={auth.api}>
        <div className="stack">
          <div className="grid grid-2">
            <Field label="Company domain"><input placeholder="e.g. razorpay.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
            <Field label="Hiring team names (optional)"><input placeholder="From LinkedIn, comma separated" value={people} onChange={(e) => setPeople(e.target.value)} /></Field>
          </div>
          <div><Button icon="search" loading={busy === "hr"} onClick={findHr}>Find HR</Button></div>
          {busy === "hr" && <div className="stack"><Skeleton h={40} /><Skeleton h={40} /></div>}
          {hr && <div className="stack">
            <div className="row">
              <Chip tone={hr.mx.ok ? "ok" : "bad"}>{hr.mx.ok ? "Mail server found" : "No mail server"}</Chip>
              <span className="muted sm">{hr.domain}{hr.domain_guessed ? " (guessed from the name, please check)" : ""} · {hr.pagesChecked.length} pages checked</span>
            </div>
            {hr.published.length > 0 && <div className="stack" style={{ gap: 8 }}>
              <b className="sm">Published on their site</b>
              {hr.published.map((e: any) => (
                <label key={e.email} className="option"><input type="radio" name="to" checked={to === e.email} onChange={() => setTo(e.email)} />
                  <span className="grow">{e.email}</span><Chip tone="ok">{e.kind === "hiring" ? "Hiring" : "General"}</Chip>
                  <a className="muted xs" href={e.source} target="_blank" rel="noreferrer">Source</a></label>))}
            </div>}
            {hr.guesses.length > 0 && <div className="stack" style={{ gap: 8 }}>
              <b className="sm">Pattern guesses <span className="muted" style={{ fontWeight: 400 }}>· may bounce</span></b>
              {hr.guesses.map((g: any) => (
                <label key={g.email} className="option"><input type="radio" name="to" checked={to === g.email} onChange={() => setTo(g.email)} />
                  <span className="grow">{g.email}</span><span className="muted xs">{g.person ? `${g.person} · ` : ""}{g.pattern}</span><Chip tone="warn">Unverified</Chip></label>))}
            </div>}
            <p className="muted xs">{hr.note}</p>
          </div>}
        </div>
      </Step>

      <Step n={2} title="Write the email and referral note" sub="Short and specific, built from your real projects and the job's requirements." usage="outreach" api={auth.api}>
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Recipient email (optional)" className="grow"><input placeholder="Pick one above or type it" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Button variant="primary" icon="sparkle" loading={busy === "write"} onClick={write}>Write outreach</Button>
          </div>
          {busy === "write" && <div className="stack"><Skeleton h={18} w="50%" /><Skeleton h={120} /></div>}
          {!out && busy !== "write" && <Empty icon="send" title="No draft yet">You'll get a cold email, a LinkedIn connection note and a referral request to copy.</Empty>}
          {out && <div className="stack">
            <div className="card flat stack" style={{ padding: 16, gap: 8 }}>
              <div className="row between"><b className="sm"><Icon name="mail" size={14} /> Email</b>
                <div className="row"><CopyButton text={`${out.email_subject}\n\n${out.email_body}`} /><a href={mailto} className="btn sm"><Icon name="external" size={14} />Open in email app</a></div></div>
              <div className="sm"><span className="muted">Subject: </span>{out.email_subject}</div>
              <div className="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{out.email_body}</div>
            </div>
            <div className="grid grid-2">
              <div className="card flat stack" style={{ padding: 16, gap: 8 }}>
                <div className="row between"><b className="sm">LinkedIn note</b><div className="row"><span className="muted xs">{out.linkedin_note.length}/300</span><CopyButton text={out.linkedin_note} /></div></div>
                <p className="sm">{out.linkedin_note}</p>
              </div>
              <div className="card flat stack" style={{ padding: 16, gap: 8 }}>
                <div className="row between"><b className="sm">Referral request</b><div className="row"><span className="muted xs">{out.referral_note.length}/300</span><CopyButton text={out.referral_note} /></div></div>
                <p className="sm">{out.referral_note}</p>
              </div>
            </div>
          </div>}
        </div>
      </Step>
    </Page>
  );
}

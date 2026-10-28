"use client";
import { useEffect, useState } from "react";
import { Page, useAuth } from "@/components/auth";
import { Alert, Button, Card, Chip, CopyButton, Empty, Field, Icon, Skeleton } from "@/components/ui";

export default function TailorPage() {
  const auth = useAuth();
  const [title, setTitle] = useState(""); const [company, setCompany] = useState(""); const [jd, setJd] = useState("");
  const [out, setOut] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [history, setHistory] = useState<any[] | null>(null);

  useEffect(() => {
    if (!auth.session) return;
    const p = new URLSearchParams(location.search);
    auth.api("/api/tailor").then((j) => setHistory(j.items || [])).catch(() => setHistory([]));
    if (p.get("jobId") || p.get("feedJobId")) generate({ jobId: p.get("jobId") || undefined, feedJobId: p.get("feedJobId") || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.session]);

  async function generate(body: any) {
    setBusy(true); setErr("");
    try { const r = await auth.api("/api/tailor", { method: "POST", json: body }); setOut(r); auth.api("/api/tailor").then((j) => setHistory(j.items || [])).catch(() => {}); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const open = async (id: string) => { setBusy(true); try { setOut(await auth.api(`/api/tailor?id=${id}`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const print = () => { const w = window.open("", "_blank"); if (!w) return; w.document.write(out.html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); };

  return (
    <Page title="Tailored resume" sub="A one-page, ATS-safe resume for one job, built only from what's really on your resume." usage="tailor" auth={auth}>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 20 }}>
        <Card title="Job">
          <div className="stack">
            <div className="grid grid-2">
              <Field label="Role"><input placeholder="e.g. ML Engineer Intern" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Company"><input placeholder="e.g. Sarvam AI" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            </div>
            <Field label="Job description"><textarea rows={7} placeholder="Paste the full job description" value={jd} onChange={(e) => setJd(e.target.value)} /></Field>
            <div className="row">
              <Button variant="primary" size="lg" icon="sparkle" loading={busy} onClick={() => generate({ job: { title, company, description: jd } })}>Tailor my resume</Button>
              <span className="muted sm">Skills the AI adds that aren't on your resume get removed automatically.</span>
            </div>
            {err && <Alert>{err}</Alert>}
          </div>
        </Card>
      </div>

      {busy && !out && <Card><div className="stack"><Skeleton h={24} w="45%" /><Skeleton h={14} w="70%" /><Skeleton h={500} /></div></Card>}

      {out && <Card
        title={<>{out.title || title || "Preview"}{(out.company || company) && <span className="muted"> · {out.company || company}</span>}</>}
        action={<div className="row"><Button variant="primary" icon="print" onClick={print}>Save as PDF</Button><CopyButton text={JSON.stringify(out.resume, null, 2)} label="Copy JSON" /></div>}>
        <div className="stack">
          {out.dropped_skills?.length > 0 && <div className="row"><span className="muted sm">Removed (not on your resume):</span>{out.dropped_skills.map((s: string) => <Chip key={s} tone="warn">{s}</Chip>)}</div>}
          {out.notes?.length > 0 && <Alert tone="info"><b>Worth adding if true:</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{out.notes.map((n: string) => <li key={n}>{n}</li>)}</ul></Alert>}
          <iframe className="preview" srcDoc={out.html} title="Tailored resume preview" sandbox="allow-modals allow-scripts" />
        </div>
      </Card>}

      {!out && !busy && <Empty icon="doc" title="Nothing tailored yet">Paste a job above, or pick “Tailor resume” on any job in the feed.</Empty>}

      <Card title="Previous versions">
        {history === null ? <div className="stack"><Skeleton h={14} /><Skeleton h={14} w="80%" /></div>
          : history.length === 0 ? <p className="muted sm">Your tailored resumes will be listed here.</p>
          : <div>{history.map((h) => (
            <div key={h.id} className="list-row">
              <Icon name="doc" /><button className="btn ghost sm grow" style={{ justifyContent: "flex-start" }} onClick={() => open(h.id)}>{h.title} · {h.company}</button>
              <span className="muted xs nowrap">{new Date(h.created_at).toLocaleDateString()}</span>
            </div>))}</div>}
      </Card>
    </Page>
  );
}

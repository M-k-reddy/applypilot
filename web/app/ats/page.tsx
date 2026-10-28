"use client";
import { useState } from "react";
import { Page, useAuth } from "@/components/auth";
import { Alert, Button, Card, Chip, CopyButton, Empty, Field, Progress, ScoreRing, Skeleton } from "@/components/ui";

const CATS: [string, string][] = [["contact", "Contact info"], ["sections", "Sections"], ["content", "Content & impact"], ["keywords", "Job keywords"], ["format", "Formatting"]];
const GRADE_TONE: Record<string, "ok" | "warn" | "bad"> = { excellent: "ok", good: "ok", "needs work": "warn", poor: "bad" };

export default function AtsPage() {
  const auth = useAuth();
  const [resumeText, setResumeText] = useState("");
  const [jd, setJd] = useState("");
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [onlyFails, setOnlyFails] = useState(false);
  const [fixes, setFixes] = useState<Record<string, { rewrites: string[]; note: string }>>({});

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setErr(""); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(""); } };
  const check = () => run("check", async () => setReport(await auth.api("/api/ats", { method: "POST", json: { resumeText: resumeText || undefined, jd: jd || undefined } })));
  const fix = (bullet: string) => run(bullet, async () => {
    const j = await auth.api("/api/ats/fix", { method: "POST", json: { bullet, jd: jd || undefined } });
    setFixes((f) => ({ ...f, [bullet]: j }));
  });

  return (
    <Page title="ATS check" sub="See how applicant tracking systems read your resume, and exactly what to fix." usage="ats" auth={auth}>
      <Card>
        <div className="grid grid-2">
          <Field label="Resume text (optional)">
            <textarea rows={9} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Leave empty to check the resume you uploaded on the Dashboard, or paste plain text here." />
          </Field>
          <Field label="Job description (optional)">
            <textarea rows={9} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste a JD to unlock keyword coverage checks." />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Button variant="primary" size="lg" icon="check" loading={busy === "check"} onClick={check}>Run ATS check</Button>
          <span className="muted sm">25–28 rule checks, then AI suggestions. The score itself is rule-based and repeatable.</span>
        </div>
        {err && <div style={{ marginTop: 12 }}><Alert>{err}</Alert></div>}
      </Card>

      {busy === "check" && !report && <Card><div className="row" style={{ gap: 20 }}><Skeleton h={120} w={120} r={60} /><div className="grow stack"><Skeleton h={18} w="40%" /><Skeleton h={12} /><Skeleton h={12} w="80%" /></div></div></Card>}

      {!report && busy !== "check" && <Empty icon="check" title="No report yet">Run a check to get your score out of 100, a pass/fail list with a fix for every miss, and AI rewrites for weak bullets.</Empty>}

      {report && <>
        <Card>
          <div className="row" style={{ gap: 28, alignItems: "center" }}>
            <ScoreRing value={report.score} size={132} stroke={11} sub="out of 100" />
            <div className="grow stack" style={{ minWidth: 240 }}>
              <div className="row"><h2>ATS score</h2><Chip tone={GRADE_TONE[report.grade]}>{report.grade}</Chip></div>
              <p className="muted sm">{report.stats.passed} of {report.stats.checks} checks passed · {report.stats.words} words · {report.stats.bullets} bullets · {report.stats.skills} skills recognised</p>
              {report.keywords && <div>
                <div className="row between sm"><b>Keyword coverage</b><span>{report.keywords.coverage}%</span></div>
                <div style={{ marginTop: 6 }}><Progress value={report.keywords.coverage} /></div>
              </div>}
              <div className="grid grid-3" style={{ gap: 10 }}>
                {CATS.map(([id, label]) => {
                  const items = report.checks.filter((c: any) => c.category === id);
                  if (!items.length) return null;
                  const pct = Math.round((items.filter((c: any) => c.pass).length / items.length) * 100);
                  return <div key={id}><div className="row between xs"><span>{label}</span><span className="muted">{pct}%</span></div><div style={{ marginTop: 4 }}><Progress value={pct} /></div></div>;
                })}
              </div>
            </div>
          </div>
          {report.suggestions && <>
            <hr className="divider" />
            <div className="stack">
              <div className="row"><Chip tone="accent">AI review</Chip><p className="sm">{report.suggestions.summary}</p></div>
              {report.suggestions.top_fixes?.length > 0 && <ol style={{ margin: 0, paddingLeft: 20 }} className="sm">{report.suggestions.top_fixes.map((t: string) => <li key={t} style={{ margin: "4px 0" }}>{t}</li>)}</ol>}
            </div>
          </>}
        </Card>

        {report.keywords && <Card title="Keywords from the job">
          <div className="chips">
            {report.keywords.matched.map((k: string) => <Chip key={k} tone="ok">✓ {k}</Chip>)}
            {report.keywords.missing.map((k: string) => <Chip key={k} tone="bad">✗ {k}</Chip>)}
          </div>
          <p className="muted xs" style={{ marginTop: 10 }}>Add a missing keyword only if you genuinely have that skill.</p>
        </Card>}

        <div className="row between">
          <h3>All checks</h3>
          <label className="check-label"><input type="checkbox" checked={onlyFails} onChange={(e) => setOnlyFails(e.target.checked)} /> Show only failed</label>
        </div>
        <div className="masonry">
          {CATS.map(([id, label]) => {
            const items = report.checks.filter((c: any) => c.category === id && (!onlyFails || !c.pass));
            if (!items.length) return null;
            return (
              <Card key={id} title={label} action={<Chip tone="outline">{items.filter((c: any) => c.pass).length}/{items.length}</Chip>}>
                <div className="checks">
                  {items.map((c: any) => (
                    <div className="check" key={c.id}>
                      <span className={`dot ${c.pass ? "ok" : "bad"}`}>{c.pass ? "✓" : "✗"}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="sm" style={{ fontWeight: 600 }}>{c.label}</div>
                        {c.detail && <div className="muted xs" style={{ marginTop: 2 }}>{c.detail}</div>}
                        {!c.pass && <div className="tip">{c.tip}</div>}
                      </div>
                    </div>))}
                </div>
              </Card>);
          })}
        </div>

        {report.weak_bullets?.length > 0 && <Card title="Weak bullets" sub="AI fix rewrites a bullet without inventing facts. Placeholders like [X%] mean: fill in only if true.">
          <div className="stack">
            {report.weak_bullets.map((b: string) => (
              <div key={b} className="card flat" style={{ padding: 14 }}>
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <p className="sm grow">{b}</p>
                  <Button size="sm" icon="sparkle" loading={busy === b} disabled={!!busy && busy !== b} onClick={() => fix(b)}>AI fix</Button>
                </div>
                {fixes[b] && <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                  {fixes[b].rewrites.map((r) => <div key={r} className="row between copyable" style={{ padding: "8px 12px" }}><span className="grow">{r}</span><CopyButton text={r} /></div>)}
                  {fixes[b].note && <p className="muted xs">{fixes[b].note}</p>}
                </div>}
              </div>))}
            {report.suggestions?.rewrites?.length > 0 && <>
              <h4>More suggested rewrites</h4>
              {report.suggestions.rewrites.map((r: any) => (
                <div key={r.before} className="copyable"><div className="muted xs" style={{ textDecoration: "line-through" }}>{r.before}</div><div style={{ marginTop: 4 }}>{r.after}</div></div>))}
            </>}
          </div>
        </Card>}
      </>}
    </Page>
  );
}

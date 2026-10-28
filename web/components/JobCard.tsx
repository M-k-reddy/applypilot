"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Chip, Icon, Progress, ScoreRing } from "./ui";

const FIT_TONE: Record<string, "ok" | "warn" | "bad" | "none"> = { good: "ok", stretch: "warn", under: "bad", unknown: "none" };
const ago = (iso?: string) => {
  if (!iso) return ""; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString();
};

/** Job card: match score ring, matched/missing skill chips, experience fit, actions, optional AI report. */
export function JobCard({ j, api, onSaved }: { j: any; api: (p: string, i?: any) => Promise<any>; onSaved?: () => void }) {
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const m = j.match;
  const idKey = j.source ? "feedJobId" : "jobId"; // feed rows carry `source`; rows from the user's own jobs table do not
  const ref = { [idKey]: j.id };
  const act = async (label: string, fn: () => Promise<void>) => { setBusy(label); setMsg(null); try { await fn(); } catch (e: any) { setMsg({ tone: "bad", text: e.message }); } finally { setBusy(""); } };
  const score = report?.score ?? m?.score ?? j.fit_score;

  return (
    <article className="job">
      <ScoreRing value={score} size={60} sub="match" />
      <div style={{ minWidth: 0 }}>
        <div className="row between job-head" style={{ alignItems: "flex-start" }}>
          <div className="grow">
            <a href={j.apply_url} target="_blank" rel="noreferrer" className="job-title">{j.title}</a>
            <div className="job-meta">
              <span><b style={{ color: "var(--text-2)" }}>{j.company}</b></span>
              <span>{j.remote ? "Remote" : j.location || "Location n/a"}</span>
              {j.posted_at && <span>{ago(j.posted_at)}</span>}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {j.fresher && <Chip tone="accent">Fresher-friendly</Chip>}
            {m && m.experience.required_min !== null && <Chip tone={FIT_TONE[m.experience.fit] || "none"} title={m.experience.note}>
              {m.experience.required_min}{m.experience.required_max ? `–${m.experience.required_max}` : "+"} yrs
            </Chip>}
          </div>
        </div>

        {m && (m.matched_skills.length > 0 || m.missing_skills.length > 0) && (
          <div className="chips" style={{ marginTop: 10 }}>
            {m.matched_skills.slice(0, 8).map((s: string) => <Chip key={s} tone="ok">✓ {s}</Chip>)}
            {m.missing_skills.slice(0, 6).map((s: string) => <Chip key={s} tone="bad">✗ {s}</Chip>)}
          </div>
        )}

        <div className="job-actions">
          <Button size="sm" icon="sparkle" loading={busy === "ai"} onClick={() => act("ai", async () => setReport(await api("/api/match", { method: "POST", json: ref })))}>AI match report</Button>
          <Link href={`/tailor?${idKey}=${j.id}`} className="btn sm"><Icon name="doc" size={16} />Tailor resume</Link>
          <Link href={`/outreach?${idKey}=${j.id}`} className="btn sm"><Icon name="send" size={16} />Super Apply</Link>
          <Button size="sm" icon="bookmark" loading={busy === "save"} onClick={() => act("save", async () => {
            const r = await api("/api/applications", { method: "POST", json: { action: "save", ...ref } });
            setMsg({ tone: "ok", text: r.duplicate ? "Already in your tracker" : "Saved to tracker" }); onSaved?.();
          })}>Save</Button>
          <a href={j.apply_url} target="_blank" rel="noreferrer" className="btn sm ghost"><Icon name="external" size={16} />Apply</a>
        </div>
        {msg && <div style={{ marginTop: 10 }}><Alert tone={msg.tone}>{msg.text}</Alert></div>}

        {report && (
          <div className="report">
            <div className="row between">
              <b>Match report · {report.score}/100</b>
              {report.ai_score !== undefined && <span className="muted xs">rules {m?.score ?? "–"} · AI {report.ai_score}</span>}
            </div>
            <div style={{ margin: "8px 0 4px" }}><Progress value={report.score} /></div>
            {report.experience?.note && <p className="sm muted" style={{ marginTop: 8 }}>{report.experience.note}</p>}
            {report.reasons?.length > 0 && <ul>{report.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
            {report.tailored_bullets?.length > 0 && <><b className="sm">Bullets to use</b><ul>{report.tailored_bullets.map((b: string) => <li key={b}>{b}</li>)}</ul></>}
            {report.cover_letter && <><b className="sm">Cover letter</b><p className="copyable" style={{ marginTop: 6 }}>{report.cover_letter}</p></>}
          </div>
        )}
      </div>
    </article>
  );
}

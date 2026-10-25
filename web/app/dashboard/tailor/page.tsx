"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Empty, ScoreRing, Spinner } from "@/components/ui";
import { applyEdits, normalizeProfile, profileText, type Profile, type Tailored, type TailorEdit } from "@/lib/profile";
import { atsScore, extractKeywords } from "@/lib/ats";

type Job = { id: string; title: string; company: string; location: string; description: string; apply_url: string; tailored: Tailored | null; cover_letter: string | null };

const wordCount = (t: string) => (t.trim().match(/\S+/g) || []).length;

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const esc = terms.slice().sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="kw">{part}</mark> : part))}</>;
}

function JobPicker() {
  const { api } = useApp();
  const { busy, run } = useBusy();
  const router = useRouter();
  const [jobs, setJobs] = useState<{ id: string; title: string; company: string; fit_score: number | null }[] | null>(null);
  const [jd, setJd] = useState({ title: "", company: "", description: "", url: "" });
  useEffect(() => { api<{ jobs: any[] }>("/api/jobs?saved=1").then((j) => setJobs(j.jobs)).catch(() => setJobs([])); }, [api]);
  const create = (e: React.FormEvent) => { e.preventDefault(); run("create", async () => {
    if (jd.description.trim().length < 80) throw new Error("Paste the full job description (at least a few lines).");
    const r = await api<{ job: { id: string } }>("/api/jobs", { method: "POST", json: { job: { ...jd, apply_url: jd.url, source: "extension" } } });
    router.push(`/dashboard/tailor?job=${r.job.id}`);
  }); };
  return (
    <>
      <PageHead title="Tailor" sub="Pick a saved job or paste a job description to tailor your resume and cover letter." />
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Saved jobs</h3></div>
          {jobs === null ? <div className="skeleton" style={{ height: 160 }} /> : jobs.length === 0
            ? <Empty icon="☆" title="No saved jobs" body="Save one from Jobs, use the Chrome extension on any job page, or paste a description here." action={{ href: "/dashboard/jobs", label: "Find jobs" }} />
            : jobs.map((j) => (
              <Link key={j.id} href={`/dashboard/tailor?job=${j.id}`} className="list-item" style={{ color: "inherit", textDecoration: "none" }}>
                <div><h3>{j.title}</h3><div className="small muted">{j.company}</div></div>
                {j.fit_score != null ? <ScoreRing size="sm" value={j.fit_score} label="Fit score" /> : <span aria-hidden="true">→</span>}
              </Link>
            ))}
        </div>
        <form className="card stack" onSubmit={create}>
          <div className="card-head"><h3>Paste a job description</h3></div>
          <div className="grid grid-2">
            <label className="field"><span>Job title</span><input className="input" required value={jd.title} onChange={(e) => setJd({ ...jd, title: e.target.value })} /></label>
            <label className="field"><span>Company</span><input className="input" value={jd.company} onChange={(e) => setJd({ ...jd, company: e.target.value })} /></label>
          </div>
          <label className="field"><span>Job link (optional)</span><input className="input" type="url" value={jd.url} onChange={(e) => setJd({ ...jd, url: e.target.value })} /></label>
          <label className="field"><span>Description</span><textarea className="textarea" rows={8} required value={jd.description} onChange={(e) => setJd({ ...jd, description: e.target.value })} /></label>
          <button className="btn btn-primary" disabled={!!busy}>{busy ? <Spinner label="Saving…" /> : "Continue →"}</button>
        </form>
      </div>
    </>
  );
}

function EditCard({ e, state, text, onDecide, onText, terms }: { e: TailorEdit; state: string; text: string; onDecide: (s: string) => void; onText: (t: string) => void; terms: string[] }) {
  const [editing, setEditing] = useState(false);
  const label = e.section === "summary" ? "Summary" : e.section === "experience" ? "Experience bullet" : "Project bullet";
  return (
    <div className={`edit ${state}`}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row"><span className="badge">{label}</span>{e.reason && <span className="small muted">{e.reason}</span>}</div>
        {state !== "pending" && <span className={`badge ${state === "accepted" ? "badge-ok" : ""}`}>{state === "accepted" ? "✓ Accepted" : "Rejected"}</span>}
      </div>
      <div className="diff">
        <div className="diff-cell old"><span className="diff-label">Current</span>{e.old || <i className="muted">(empty)</i>}</div>
        <div className="diff-cell new"><span className="diff-label">Suggested</span>
          {editing ? <textarea className="textarea" rows={3} value={text} onChange={(ev) => onText(ev.target.value)} aria-label="Edit suggestion" autoFocus />
            : <Highlight text={text} terms={terms} />}
        </div>
      </div>
      {e.warnings.length > 0 && <div className="alert alert-warn small" style={{ marginTop: 10 }}>⚠ {e.warnings.join(" ")}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-sm btn-ok" onClick={() => onDecide(state === "accepted" ? "pending" : "accepted")} aria-pressed={state === "accepted"}>{state === "accepted" ? "Undo accept" : "✓ Accept"}</button>
        <button className="btn btn-sm" onClick={() => onDecide(state === "rejected" ? "pending" : "rejected")} aria-pressed={state === "rejected"}>{state === "rejected" ? "Undo reject" : "✕ Reject"}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "✎ Edit"}</button>
      </div>
    </div>
  );
}

function TailorJob({ jobId }: { jobId: string }) {
  const { api, toast, refreshMe } = useApp();
  const { busy, run } = useBusy();
  const [job, setJob] = useState<Job | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"resume" | "letter">("resume");
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [letter, setLetter] = useState("");
  const [tone, setTone] = useState("warm");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    Promise.all([api<{ job: Job }>(`/api/jobs/${jobId}`), api<{ profile: Profile }>("/api/profile")]).then(([j, p]) => {
      setJob(j.job); setProfile(normalizeProfile(p.profile));
      setDecisions(j.job.tailored?.decisions || {}); setOverrides(j.job.tailored?.overrides || {}); setLetter(j.job.cover_letter || "");
    }).catch((e) => setErr(e.message));
  }, [api, jobId]);

  const persist = useCallback((d: Record<string, string>, o: Record<string, string>) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { api("/api/tailor", { method: "PUT", json: { jobId, decisions: d, overrides: o } }).catch(() => {}); }, 700);
  }, [api, jobId]);

  const jd = job ? `${job.title}\n${job.description || ""}` : "";
  const keywords = useMemo(() => extractKeywords(jd), [jd]);
  const tailored: Tailored | null = job?.tailored ? { ...job.tailored, decisions, overrides } : null;
  const composed = useMemo(() => (profile ? applyEdits(profile, tailored) : null), [profile, tailored]); // eslint-disable-line react-hooks/exhaustive-deps
  const before = useMemo(() => (profile ? atsScore(jd, profileText(profile), keywords) : null), [profile, jd, keywords]);
  const now = useMemo(() => (composed ? atsScore(jd, profileText(composed), keywords) : null), [composed, jd, keywords]);

  if (err) return <Empty icon="!" title="Could not open this job" body={err} action={{ href: "/dashboard/tailor", label: "Pick another job" }} />;
  if (!job || !profile || !before || !now) return <><PageHead title="Tailor" /><div className="skeleton" style={{ height: 420 }} /></>;

  const edits = job.tailored?.edits || [];
  const decide = (id: string, s: string) => { const d = { ...decisions, [id]: s }; setDecisions(d); persist(d, overrides); };
  const setText = (id: string, t: string) => { const o = { ...overrides, [id]: t }; setOverrides(o); persist(decisions, o); };
  const acceptAll = () => { const d = { ...decisions }; edits.forEach((e) => { if (d[e.id] !== "rejected" && !e.warnings.length) d[e.id] = "accepted"; }); setDecisions(d); persist(d, overrides); };
  const accepted = edits.filter((e) => decisions[e.id] === "accepted").length;
  const hasProfile = !!(profile.full_name || profile.experience.length || profile.projects.length);

  const generate = () => run("gen", async () => {
    const r = await api<{ tailored: Tailored }>("/api/tailor", { method: "POST", json: { jobId } });
    setJob({ ...job, tailored: r.tailored }); setDecisions({}); setOverrides({}); refreshMe();
    toast(r.tailored.edits.length ? `${r.tailored.edits.length} suggestions ready. Review each one.` : "Your resume already fits this job well. No edits suggested.");
  });
  const exportPdf = () => {
    try { localStorage.setItem("ap-print", JSON.stringify({ profile: composed, job: { title: job.title, company: job.company } })); } catch { toast("Could not prepare the PDF (storage blocked).", true); return; }
    window.open("/print/resume", "_blank", "noopener");
  };
  const genLetter = () => run("letter", async () => {
    const r = await api<{ cover_letter: string }>("/api/cover-letter", { method: "POST", json: { jobId, tone } });
    setLetter(r.cover_letter); refreshMe();
  });
  const saveLetter = () => run("saveletter", async () => { await api("/api/cover-letter", { method: "PUT", json: { jobId, cover_letter: letter } }); toast("Cover letter saved ✓"); });
  const copyLetter = async () => { try { await navigator.clipboard.writeText(letter); toast("Copied to clipboard ✓"); } catch { toast("Copy failed. Select the text and copy manually.", true); } };
  const downloadLetter = () => {
    const blob = new Blob([letter], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `Cover letter - ${job.company || "company"} - ${job.title}.txt`.replace(/[\\/:*?"<>|]/g, "-");
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const wc = wordCount(letter);

  return (
    <>
      <PageHead title={job.title} sub={`${job.company}${job.location ? " · " + job.location : ""}`}>
        <Link href="/dashboard/tailor" className="btn btn-ghost">← All jobs</Link>
        {job.apply_url && <a className="btn" href={job.apply_url} target="_blank" rel="noopener noreferrer">Open job ↗</a>}
      </PageHead>

      {!hasProfile && <div className="alert alert-warn" style={{ marginBottom: 16 }}>Your profile is empty. <Link href="/dashboard/profile">Upload your resume</Link> first so we have real facts to work with.</div>}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 300px", alignItems: "start" }}>
        <div>
          <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
            <button role="tab" aria-selected={tab === "resume"} onClick={() => setTab("resume")}>Resume edits {edits.length ? `(${accepted}/${edits.length})` : ""}</button>
            <button role="tab" aria-selected={tab === "letter"} onClick={() => setTab("letter")}>Cover letter</button>
          </div>

          {tab === "resume" && (!job.tailored ? (
            <Empty icon="⇄" title="Tailor your resume to this job" body="AI suggests rewrites for your summary and bullets using only facts from your profile. You review each one side by side." action={{ label: busy === "gen" ? "Generating…" : "Generate suggestions", onClick: generate }} />
          ) : (
            <>
              <div className="row between" style={{ marginBottom: 12 }}>
                <span className="small muted">{edits.length} suggestions · {accepted} accepted</span>
                <div className="row">
                  <button className="btn btn-sm" onClick={acceptAll} disabled={!edits.length}>Accept all without warnings</button>
                  <button className="btn btn-sm btn-ghost" onClick={generate} disabled={!!busy}>{busy === "gen" ? <Spinner label="Regenerating…" /> : "↻ Regenerate"}</button>
                </div>
              </div>
              {edits.length === 0 && <Empty icon="✓" title="No changes needed" body="Your resume already covers this job's language well. You can still export it." />}
              {edits.map((e) => (
                <EditCard key={e.id} e={e} state={decisions[e.id] || "pending"} text={overrides[e.id] ?? e.new}
                  onDecide={(s) => decide(e.id, s)} onText={(t) => setText(e.id, t)} terms={keywords.map((k) => k.term)} />
              ))}
            </>
          ))}

          {tab === "letter" && (
            <div className="card">
              <div className="card-head">
                <h3>Cover letter</h3>
                <div className="row">
                  <label className="sr-only" htmlFor="tone">Tone</label>
                  <select id="tone" className="select" style={{ width: "auto" }} value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option value="warm">Warm</option><option value="formal">Formal</option><option value="concise">Concise</option>
                  </select>
                  <button className="btn btn-primary" onClick={genLetter} disabled={!!busy}>{busy === "letter" ? <Spinner label="Writing…" /> : letter ? "↻ Rewrite" : "Generate"}</button>
                </div>
              </div>
              {letter ? (
                <>
                  <textarea className="textarea" rows={14} value={letter} onChange={(e) => setLetter(e.target.value)} aria-label="Cover letter text" />
                  <div className="row between" style={{ marginTop: 10 }}>
                    <span className={`small ${wc > 200 ? "" : "muted"}`} style={wc > 200 ? { color: "var(--warn)" } : undefined}>{wc} words {wc > 200 ? "· aim for under 200" : ""}</span>
                    <div className="row">
                      <button className="btn btn-sm" onClick={copyLetter}>Copy</button>
                      <button className="btn btn-sm" onClick={downloadLetter}>Download .txt</button>
                      <button className="btn btn-sm btn-primary" onClick={saveLetter} disabled={!!busy}>{busy === "saveletter" ? <Spinner /> : "Save"}</button>
                    </div>
                  </div>
                </>
              ) : <p className="muted mb-0">Under 200 words, using only your real projects and skills. You can edit it before copying.</p>}
            </div>
          )}
        </div>

        <aside className="sticky-score stack">
          <div className="card">
            <div className="row" style={{ gap: 16 }}>
              <ScoreRing value={now.score} label="ATS keyword score" />
              <div>
                <b>ATS keyword match</b>
                <div className="small muted">Was {before.score}{now.score !== before.score ? <span style={{ color: now.score > before.score ? "var(--ok)" : "var(--bad)", fontWeight: 700 }}> · {now.score > before.score ? "+" : ""}{now.score - before.score}</span> : null}</div>
              </div>
            </div>
            <hr className="divider" />
            <b className="small">Matched ({now.matched.length})</b>
            <div className="chips" style={{ margin: "6px 0 12px" }}>{now.matched.length ? now.matched.map((k) => <span key={k} className="chip chip-ok">{k}</span>) : <span className="small muted">None yet</span>}</div>
            <b className="small">Missing ({now.missing.length})</b>
            <div className="chips" style={{ marginTop: 6 }}>{now.missing.length ? now.missing.map((k) => <span key={k} className="chip chip-miss">{k}</span>) : <span className="small muted">All covered 🎉</span>}</div>
            <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>Only add a missing keyword to your profile if it is genuinely true.</p>
          </div>
          <button className="btn btn-grad btn-lg" onClick={exportPdf}>⤓ Export ATS-friendly PDF</button>
          <p className="tiny muted center mb-0">Opens a print view. Choose “Save as PDF”.</p>
        </aside>
      </div>
      <style>{`@media (max-width: 1000px){ .main .grid[style*="300px"]{ grid-template-columns: 1fr !important; } .sticky-score{ position: static; } }`}</style>
    </>
  );
}

function TailorRouter() {
  const sp = useSearchParams();
  const id = sp.get("job");
  return id ? <TailorJob key={id} jobId={id} /> : <JobPicker />;
}

export default function TailorPage() {
  return <Suspense fallback={<div className="skeleton" style={{ height: 300 }} />}><TailorRouter /></Suspense>;
}

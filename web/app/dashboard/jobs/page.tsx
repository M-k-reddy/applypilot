"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Empty, ScoreRing, Spinner } from "@/components/ui";

type Listing = { id?: string; external_id: string; source: string; title: string; company: string; location: string; remote: boolean; apply_url: string; description?: string; posted_at: string | null; salary: string; fresher?: boolean; fit_score?: number | null };
type Match = { fit_score: number; verdict: string; reasons: string[]; gaps: string[]; missing_keywords: string[]; ats: { score: number } };
type Prep = { q: string; type: string; pointers: string[] }[];

const SOURCE: Record<string, string> = { adzuna: "Adzuna", remotive: "Remotive", arbeitnow: "Arbeitnow", jsearch: "JSearch", extension: "Saved from web" };
const ago = (d: string | null) => { if (!d) return ""; const days = Math.floor((Date.now() - Date.parse(d)) / 86400_000); return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`; };

export default function JobsPage() {
  const { api, toast, refreshMe } = useApp();
  const { busy, run } = useBusy();
  const router = useRouter();
  const [tab, setTab] = useState<"search" | "saved">("search");
  const [q, setQ] = useState("software developer fresher");
  const [loc, setLoc] = useState("India");
  const [remote, setRemote] = useState(false);
  const [fresher, setFresher] = useState(true);
  const [results, setResults] = useState<Listing[] | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Listing[] | null>(null);
  const [savedIds, setSavedIds] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [prep, setPrep] = useState<Record<string, Prep>>({});
  const [open, setOpen] = useState<string | null>(null);

  const loadSaved = () => api<{ jobs: Listing[] }>("/api/jobs?saved=1").then((j) => {
    setSaved(j.jobs); setSavedIds(Object.fromEntries(j.jobs.map((x) => [x.external_id, x.id!])));
  }).catch(() => setSaved([]));
  useEffect(() => { loadSaved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (e?: React.FormEvent) => { e?.preventDefault(); run("search", async () => {
    const p = new URLSearchParams({ q, location: loc, remote: String(remote), fresher: String(fresher) });
    const j = await api<{ jobs: Listing[]; sources: Record<string, string> }>(`/api/jobs?${p}`);
    setResults(j.jobs); setSources(j.sources);
  }); };

  const ensureSaved = async (j: Listing, track = false): Promise<string> => {
    if (j.id) return j.id;
    if (savedIds[j.external_id] && !track) return savedIds[j.external_id];
    const r = await api<{ job: Listing }>("/api/jobs", { method: "POST", json: { job: j, track } });
    setSavedIds((s) => ({ ...s, [j.external_id]: r.job.id! }));
    return r.job.id!;
  };

  const save = (j: Listing) => run(`save:${j.external_id}`, async () => { await ensureSaved(j, true); toast("Saved to your tracker ✓"); loadSaved(); });
  const fit = (j: Listing) => run(`fit:${j.external_id}`, async () => {
    const id = await ensureSaved(j);
    const m = await api<Match>("/api/match", { method: "POST", json: { jobId: id } });
    setMatches((x) => ({ ...x, [j.external_id]: m })); setOpen(j.external_id); refreshMe();
  });
  const interview = (j: Listing) => run(`prep:${j.external_id}`, async () => {
    const id = await ensureSaved(j);
    const r = await api<{ questions: Prep }>("/api/interview", { method: "POST", json: { jobId: id } });
    setPrep((x) => ({ ...x, [j.external_id]: r.questions })); setOpen(j.external_id); refreshMe();
  });
  const tailor = (j: Listing) => run(`tailor:${j.external_id}`, async () => { const id = await ensureSaved(j); router.push(`/dashboard/tailor?job=${id}`); });

  const list = tab === "search" ? results : saved;

  return (
    <>
      <PageHead title="Jobs" sub="Search free job sources, check your fit, and tailor in one click.">
        <div className="tabs" role="tablist" aria-label="Job lists">
          <button role="tab" aria-selected={tab === "search"} onClick={() => setTab("search")}>Search</button>
          <button role="tab" aria-selected={tab === "saved"} onClick={() => setTab("saved")}>Saved {saved ? `(${saved.length})` : ""}</button>
        </div>
      </PageHead>

      {tab === "search" && (
        <form className="card" onSubmit={search} style={{ marginBottom: 16 }}>
          <div className="grid" style={{ gridTemplateColumns: "2fr 1.2fr auto", alignItems: "end" }}>
            <label className="field"><span>Role or skills</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="react intern, data analyst fresher…" /></label>
            <label className="field"><span>Location</span><input className="input" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Hyderabad, Bengaluru, India" /></label>
            <button className="btn btn-primary" disabled={!!busy}>{busy === "search" ? <Spinner label="Searching…" /> : "Search"}</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="check"><input type="checkbox" checked={fresher} onChange={(e) => setFresher(e.target.checked)} /> Fresher-friendly only</label>
            <label className="check"><input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Remote only</label>
            <span className="spacer" />
            {Object.entries(sources).map(([k, v]) => <span key={k} className="badge" title={`${SOURCE[k]}: ${v}`}>{SOURCE[k]}: {v}</span>)}
          </div>
        </form>
      )}

      {list === null ? (tab === "search"
        ? <Empty icon="⌕" title="Search for your next role" body="Try “python intern”, “frontend fresher” or “data analyst”. Results come from free job boards, India first." />
        : <div className="skeleton" style={{ height: 200 }} />)
        : list.length === 0 ? (tab === "search"
          ? <Empty icon="∅" title="No matching jobs" body="Try a broader role, switch off a filter, or set location to India." />
          : <Empty icon="☆" title="No saved jobs yet" body="Save jobs from search or from any job page with the Chrome extension." action={{ label: "Search jobs", onClick: () => setTab("search") }} />)
        : (
          <div>
            {list.map((j) => {
              const m = matches[j.external_id]; const pr = prep[j.external_id]; const isSaved = !!(j.id || savedIds[j.external_id]);
              const k = j.external_id;
              return (
                <article key={k} className="list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div className="row between" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3>{j.title}</h3>
                      <div className="small muted">{j.company} · {j.remote ? "Remote" : j.location || "—"}{j.posted_at ? ` · ${ago(j.posted_at)}` : ""}{j.salary ? ` · ${j.salary}` : ""}</div>
                      <div className="row" style={{ marginTop: 8, gap: 6 }}>
                        <span className="badge">via {SOURCE[j.source] || j.source}</span>
                        {j.fresher && <span className="badge badge-ok">Fresher-friendly</span>}
                        {j.remote && <span className="badge badge-brand">Remote</span>}
                        {isSaved && <span className="badge">Saved</span>}
                      </div>
                    </div>
                    {(m || j.fit_score != null) && <ScoreRing size="sm" value={m?.fit_score ?? j.fit_score ?? 0} label="Fit score" />}
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => tailor(j)} disabled={!!busy}>{busy === `tailor:${k}` ? <Spinner /> : "⇄ Tailor resume"}</button>
                    <button className="btn btn-sm" onClick={() => fit(j)} disabled={!!busy}>{busy === `fit:${k}` ? <Spinner label="Scoring…" /> : "◎ Fit score"}</button>
                    <button className="btn btn-sm" onClick={() => interview(j)} disabled={!!busy}>{busy === `prep:${k}` ? <Spinner label="Preparing…" /> : "? Interview prep"}</button>
                    {tab === "search" && <button className="btn btn-sm" onClick={() => save(j)} disabled={!!busy}>{busy === `save:${k}` ? <Spinner /> : "☆ Save to tracker"}</button>}
                    <a className="btn btn-sm btn-ghost" href={j.apply_url} target="_blank" rel="noopener noreferrer">Apply ↗</a>
                    {(m || pr) && <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>{open === k ? "Hide details" : "Show details"}</button>}
                  </div>
                  {open === k && m && (
                    <div className="grid grid-2" style={{ marginTop: 14 }}>
                      <div>
                        <p style={{ fontWeight: 650 }}>{m.verdict}</p>
                        <ul className="small" style={{ paddingLeft: 18 }}>{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                        {m.gaps.length > 0 && <><b className="small">Gaps</b><ul className="small muted" style={{ paddingLeft: 18 }}>{m.gaps.map((r) => <li key={r}>{r}</li>)}</ul></>}
                      </div>
                      <div>
                        <div className="small" style={{ marginBottom: 6 }}><b>ATS keyword match:</b> {m.ats?.score ?? 0}%</div>
                        <b className="small">Missing keywords</b>
                        <div className="chips" style={{ marginTop: 6 }}>{m.missing_keywords.length ? m.missing_keywords.map((x) => <span key={x} className="chip chip-miss">{x}</span>) : <span className="small muted">None 🎉</span>}</div>
                      </div>
                    </div>
                  )}
                  {open === k && pr && (
                    <div style={{ marginTop: 14 }}>
                      <b>Likely interview questions</b>
                      <ol style={{ paddingLeft: 20 }}>{pr.map((x) => (
                        <li key={x.q} style={{ marginBottom: 8 }}><span style={{ fontWeight: 650 }}>{x.q}</span> <span className="badge">{x.type}</span>
                          <ul className="small muted" style={{ paddingLeft: 18 }}>{x.pointers.map((p) => <li key={p}>{p}</li>)}</ul></li>
                      ))}</ol>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      {tab === "search" && results && results.some((r) => r.source === "remotive") && <p className="tiny muted" style={{ marginTop: 12 }}>Remote listings courtesy of <a href="https://remotive.com" target="_blank" rel="noopener noreferrer">Remotive</a>. Job data also from Adzuna and Arbeitnow where shown.</p>}
      {tab === "saved" && saved && saved.length > 0 && <p className="tiny muted" style={{ marginTop: 12 }}>Tip: open a job in the <Link href="/dashboard/tailor">Tailor</Link> view to review edits and export a PDF.</p>}
    </>
  );
}

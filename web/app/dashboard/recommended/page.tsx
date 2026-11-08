"use client";
import { useEffect, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Empty, Spinner } from "@/components/ui";
import { BOARD_TABS, boardLabel, initials, ago } from "@/lib/stats";

type Rec = { id: string; external_id: string; source: string; board: string; title: string; company: string; location: string; apply_url: string; salary: string; description: string; fit_score: number | null; created_at: string };

export default function RecommendedPage() {
  const { api, toast } = useApp();
  const { busy, run } = useBusy();
  const [jobs, setJobs] = useState<Rec[] | null>(null);
  const [board, setBoard] = useState("all");
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => { api<{ jobs: Rec[] }>("/api/jobs?recommended=1").then((j) => setJobs(j.jobs)).catch(() => setJobs([])); }, [api]);

  const save = (j: Rec) => run(`save:${j.id}`, async () => {
    await api("/api/jobs", { method: "POST", json: { job: j, track: true } });
    setSaved((s) => ({ ...s, [j.id]: true })); toast("Saved to your tracker ✓");
  });

  const all = jobs || [];
  const boards = BOARD_TABS.filter((b) => all.some((j) => j.board === b));
  const rows = all.filter((j) => board === "all" || j.board === board);

  return (
    <>
      <PageHead title="Recommended jobs" sub="From your connected job boards, updated each time Auto runs" />
      {jobs === null ? <div className="skeleton" style={{ height: 300 }} /> : all.length === 0 ? (
        <Empty icon="★" title="No recommendations yet" body="Turn on Auto and run once to see jobs your boards recommend." action={{ href: "/dashboard/auto", label: "Open Auto-apply" }} />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Job boards" style={{ marginBottom: 12 }}>
            {["all", ...boards].map((b) => (
              <button key={b} role="tab" aria-selected={board === b} onClick={() => setBoard(b)}>
                {b === "all" ? "All" : boardLabel(b)} <span className="badge">{b === "all" ? all.length : all.filter((j) => j.board === b).length}</span>
              </button>
            ))}
          </div>
          {rows.map((j) => (
            <div key={j.id} className="jrow">
              <div className="jlogo" aria-hidden="true">{initials(j.company || j.title)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3>{j.title}</h3>
                <div className="small muted">{[j.company, j.location, j.salary].filter(Boolean).join(" · ")}</div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {boardLabel(j.board)} · found {ago(j.created_at)}
                  {j.fit_score != null && <> · <b style={{ color: "var(--ok)" }}>Fit {j.fit_score}%</b></>}
                </div>
              </div>
              <div className="jside">
                <a className="btn btn-sm btn-primary" href={j.apply_url} target="_blank" rel="noopener noreferrer">Apply ↗</a>
                <button className="btn btn-sm btn-ghost" disabled={!!busy || saved[j.id]} onClick={() => save(j)}>{busy === `save:${j.id}` ? <Spinner /> : saved[j.id] ? "Saved" : "Save"}</button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

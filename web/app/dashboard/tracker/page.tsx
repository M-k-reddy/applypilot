"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Empty, Spinner } from "@/components/ui";
import { weekStats, siteOf, BOARD_TABS, boardLabel, initials, istTime, type AppRow } from "@/lib/stats";

const COLS = [
  { id: "saved", label: "Saved", cls: "" },
  { id: "needs_review", label: "Needs review", cls: "badge-warn" },
  { id: "applied", label: "Applied", cls: "badge-ok" },
  { id: "interview", label: "Interview", cls: "badge-brand" },
  { id: "offer", label: "Offer", cls: "badge-ok" },
  { id: "rejected", label: "Rejected", cls: "badge-bad" }
];
const boardOf = (a: AppRow) => (a.board && BOARD_TABS.includes(a.board) ? a.board : "others");

function CardEditor({ a, onClose, onSave, onDelete }: { a: AppRow; onClose: () => void; onSave: (patch: Partial<AppRow>) => Promise<void>; onDelete: () => Promise<void> }) {
  const [notes, setNotes] = useState(a.notes || "");
  const [follow, setFollow] = useState(a.follow_up || "");
  const [status, setStatus] = useState(a.status);
  const [saving, setSaving] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="scrim" style={{ display: "grid", placeItems: "center", zIndex: 70, background: "rgba(0,0,0,.4)", position: "fixed", inset: 0 }} onClick={onClose}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="card-title" style={{ width: "min(520px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><div><h3 id="card-title">{a.company || "Company"}</h3><div className="small muted">{a.title}{siteOf(a) ? ` · ${siteOf(a)}` : ""}</div></div><button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="stack">
          <label className="field"><span>Status</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
          <label className="field"><span>Follow-up date</span><input className="input" type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></label>
          <label className="field"><span>Notes</span><textarea className="textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter name, round details, what to prepare…" /></label>
          <div className="row between">
            <button className="btn btn-sm btn-ghost btn-danger" onClick={async () => { if (confirm("Delete this card?")) { setSaving(true); await onDelete(); } }}>Delete</button>
            <div className="row">
              {a.job_id && <Link className="btn btn-sm" href={`/dashboard/tailor?job=${a.job_id}`}>Tailor</Link>}
              {a.page_url && <a className="btn btn-sm" href={a.page_url} target="_blank" rel="noopener noreferrer">Open ↗</a>}
              <button className="btn btn-primary" disabled={saving} onClick={async () => { setSaving(true); await onSave({ notes, follow_up: follow || null, status }); }}>{saving ? <Spinner /> : "Save"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrackerPage() {
  const { api, toast } = useApp();
  const { busy, run } = useBusy();
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [editing, setEditing] = useState<AppRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [board, setBoard] = useState("all");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState({ company: "", title: "", page_url: "" });

  useEffect(() => { api<{ applications: AppRow[] }>("/api/applications").then((j) => setApps(j.applications)).catch(() => setApps([])); }, [api]);

  const patch = async (id: string, p: Partial<AppRow>) => {
    const prev = apps;
    setApps((xs) => xs!.map((x) => (x.id === id ? { ...x, ...p, updated_at: new Date().toISOString(), applied_at: p.status === "applied" && x.status !== "applied" ? new Date().toISOString() : x.applied_at } : x)));
    try { await api("/api/applications", { method: "POST", json: { id, ...p } }); }
    catch (e: any) { setApps(prev); toast(e.message, true); }
  };

  const add = (e: React.FormEvent) => { e.preventDefault(); run("add", async () => {
    const r = await api<{ application: AppRow }>("/api/applications", { method: "POST", json: { ...form, status: "saved" } });
    setApps((xs) => [r.application, ...(xs || [])]); setForm({ company: "", title: "", page_url: "" }); setAdding(false);
  }); };

  const all = apps || [];
  const s = weekStats(all);
  const today = new Date().toISOString().slice(0, 10);
  const inBoard = all.filter((a) => board === "all" || boardOf(a) === board);
  const rows = inBoard.filter((a) => status === "all" || a.status === status)
    .sort((a, b) => Date.parse(b.applied_at || b.updated_at) - Date.parse(a.applied_at || a.updated_at));

  return (
    <>
      <PageHead title="Applied jobs" sub={`${s.thisWeek} applied this week · ${s.interviews} interviews`}>
        <button className="btn btn-primary" onClick={() => setAdding(!adding)}>+ Add application</button>
      </PageHead>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{s.thisWeek}</b><span>Applied this week</span></div>
        <div className="stat"><b>{s.responseRate}%</b><span>Response rate</span></div>
        <div className="stat"><b>{s.interviews}</b><span>Interviews & offers</span></div>
        <div className="stat"><b>{all.length}</b><span>Total cards</span></div>
      </div>

      {adding && (
        <form className="card" onSubmit={add} style={{ marginBottom: 16 }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1.4fr auto", alignItems: "end" }}>
            <label className="field"><span>Company</span><input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required /></label>
            <label className="field"><span>Role</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field"><span>Link (optional)</span><input className="input" type="url" value={form.page_url} onChange={(e) => setForm({ ...form, page_url: e.target.value })} /></label>
            <button className="btn btn-primary" disabled={!!busy}>{busy ? <Spinner /> : "Add"}</button>
          </div>
        </form>
      )}

      {apps === null ? <div className="skeleton" style={{ height: 360 }} /> : apps.length === 0 ? (
        <Empty icon="▦" title="No applications yet" body="Save a job from search or the Chrome extension, or add one manually. Auto-apply results appear here too." action={{ href: "/dashboard/jobs", label: "Find jobs" }} />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Job boards" style={{ marginBottom: 12 }}>
            {["all", ...BOARD_TABS, "others"].map((b) => (
              <button key={b} role="tab" aria-selected={board === b} onClick={() => setBoard(b)}>
                {b === "all" ? "All" : boardLabel(b)} <span className="badge">{b === "all" ? all.length : all.filter((a) => boardOf(a) === b).length}</span>
              </button>
            ))}
          </div>
          <div className="chips" style={{ marginBottom: 6 }} aria-label="Status filter">
            {[{ id: "all", label: "All" }, ...COLS].map((c) => (
              <button key={c.id} className="chip" aria-pressed={status === c.id} onClick={() => setStatus(c.id)}>
                {c.label} {c.id === "all" ? inBoard.length : inBoard.filter((a) => a.status === c.id).length}
              </button>
            ))}
          </div>
          {rows.length === 0 ? <p className="small muted" style={{ padding: 16 }}>Nothing here.</p> : rows.map((a) => {
            const col = COLS.find((c) => c.id === a.status);
            const overdue = a.follow_up && a.follow_up <= today && !["offer", "rejected"].includes(a.status);
            const when = a.applied_at ? `Applied ${istTime(a.applied_at)}` : `Updated ${istTime(a.updated_at)}`;
            return (
              <div key={a.id} className="jrow click" role="button" tabIndex={0} onClick={() => setEditing(a)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(a); } }}
                aria-label={`${a.title || "Role"} at ${a.company || "company"}. Open details`}>
                <div className="jlogo" aria-hidden="true">{initials(a.company || a.title)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>{a.title || "Role"}</h3>
                  <div className="small muted">{a.company || "Company"}</div>
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    {[siteOf(a), `${when} IST`].filter(Boolean).join(" · ")}{a.source === "auto" && <> · <b>Auto</b></>}
                    {a.follow_up && <span style={overdue ? { color: "var(--warn)" } : undefined}> · Follow up {a.follow_up}</span>}
                    {a.notes && <span title={a.notes}> · ✎</span>}
                  </div>
                </div>
                <div className="jside">
                  <span className={`badge ${col?.cls || ""}`}>{col?.label || a.status}</span>
                  {a.page_url && <a className="small" href={a.page_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>View job ↗</a>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {editing && <CardEditor a={editing} onClose={() => setEditing(null)}
        onSave={async (p) => { await patch(editing.id, p); setEditing(null); }}
        onDelete={async () => {
          try { await api(`/api/applications?id=${editing.id}`, { method: "DELETE" }); setApps((xs) => xs!.filter((x) => x.id !== editing.id)); setEditing(null); }
          catch (e: any) { toast(e.message, true); }
        }} />}
    </>
  );
}

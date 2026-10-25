"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Empty, Spinner } from "@/components/ui";
import { weekStats, type AppRow } from "@/lib/stats";

const COLS = [
  { id: "saved", label: "Saved", color: "var(--muted)" },
  { id: "applied", label: "Applied", color: "var(--info)" },
  { id: "interview", label: "Interview", color: "var(--brand)" },
  { id: "offer", label: "Offer", color: "var(--ok)" },
  { id: "rejected", label: "Rejected", color: "var(--bad)" }
];

function CardEditor({ a, onClose, onSave, onDelete }: { a: AppRow; onClose: () => void; onSave: (patch: Partial<AppRow>) => Promise<void>; onDelete: () => Promise<void> }) {
  const [notes, setNotes] = useState(a.notes || "");
  const [follow, setFollow] = useState(a.follow_up || "");
  const [status, setStatus] = useState(a.status);
  const [saving, setSaving] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="scrim" style={{ display: "grid", placeItems: "center", zIndex: 70, background: "rgba(0,0,0,.4)", position: "fixed", inset: 0 }} onClick={onClose}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="card-title" style={{ width: "min(520px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><div><h3 id="card-title">{a.company || "Company"}</h3><div className="small muted">{a.title}</div></div><button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<AppRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ company: "", title: "", page_url: "" });

  useEffect(() => { api<{ applications: AppRow[] }>("/api/applications").then((j) => setApps(j.applications)).catch(() => setApps([])); }, [api]);

  const patch = async (id: string, p: Partial<AppRow>) => {
    const prev = apps;
    setApps((xs) => xs!.map((x) => (x.id === id ? { ...x, ...p, updated_at: new Date().toISOString(), applied_at: p.status === "applied" && x.status !== "applied" ? new Date().toISOString() : x.applied_at } : x)));
    try { await api("/api/applications", { method: "POST", json: { id, ...p } }); }
    catch (e: any) { setApps(prev); toast(e.message, true); }
  };

  const drop = (status: string, beforeId?: string) => {
    if (!dragId || !apps) return;
    const col = apps.filter((x) => x.status === status && x.id !== dragId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    let position: number;
    const idx = beforeId ? col.findIndex((x) => x.id === beforeId) : -1;
    if (idx === -1) position = (col.at(-1)?.position ?? 0) + 1;
    else position = idx === 0 ? (col[0].position ?? 0) - 1 : ((col[idx - 1].position ?? 0) + (col[idx].position ?? 0)) / 2;
    const cur = apps.find((x) => x.id === dragId);
    patch(dragId, cur?.status === status ? { position } : { status, position });
    setDragId(null); setOver(null);
  };

  const add = (e: React.FormEvent) => { e.preventDefault(); run("add", async () => {
    const r = await api<{ application: AppRow }>("/api/applications", { method: "POST", json: { ...form, status: "saved" } });
    setApps((xs) => [r.application, ...(xs || [])]); setForm({ company: "", title: "", page_url: "" }); setAdding(false);
  }); };

  const s = weekStats(apps || []);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead title="Tracker" sub="Drag cards between columns. Click a card for notes and a follow-up date.">
        <button className="btn btn-primary" onClick={() => setAdding(!adding)}>+ Add application</button>
      </PageHead>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{s.thisWeek}</b><span>Applied this week</span></div>
        <div className="stat"><b>{s.responseRate}%</b><span>Response rate</span></div>
        <div className="stat"><b>{s.interviews}</b><span>Interviews & offers</span></div>
        <div className="stat"><b>{(apps || []).length}</b><span>Total cards</span></div>
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
        <Empty icon="▦" title="Your board is empty" body="Save a job from search or the Chrome extension, or add one manually. Autofilled applications appear here too." action={{ href: "/dashboard/jobs", label: "Find jobs" }} />
      ) : (
        <div className="kanban" aria-label="Application board">
          {COLS.map((c) => {
            const items = apps.filter((a) => a.status === c.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
            return (
              <section key={c.id} className={`kcol ${over === c.id ? "over" : ""}`} aria-label={`${c.label} column`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(c.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => { e.preventDefault(); drop(c.id); }}>
                <div className="kcol-head"><span><span className="dot" style={{ background: c.color }} />{c.label}</span><span className="badge">{items.length}</span></div>
                {items.map((a) => {
                  const overdue = a.follow_up && a.follow_up <= today && !["offer", "rejected"].includes(a.status);
                  return (
                    <div key={a.id} className={`kcard ${dragId === a.id ? "dragging" : ""} ${overdue ? "overdue" : ""}`} draggable
                      onDragStart={(e) => { setDragId(a.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", a.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(c.id, a.id); }}
                      onClick={() => setEditing(a)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(a); } }}
                      role="button" tabIndex={0} aria-label={`${a.company || "Company"}, ${a.title || "role"}. Open details`}>
                      <h4>{a.company || "Company"}</h4>
                      <div className="meta">{a.title || "—"}</div>
                      <div className="row" style={{ marginTop: 8, gap: 6 }}>
                        {a.autofilled_at && <span className="badge badge-brand">Autofilled</span>}
                        {a.follow_up && <span className={`badge ${overdue ? "badge-warn" : ""}`}>Follow up {a.follow_up}</span>}
                        {a.notes && <span className="badge" title={a.notes}>✎ note</span>}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <div className="tiny muted center" style={{ padding: 16 }}>Drop here</div>}
              </section>
            );
          })}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>Keyboard: open a card with Enter and change its status there.</p>

      {editing && <CardEditor a={editing} onClose={() => setEditing(null)}
        onSave={async (p) => { await patch(editing.id, p); setEditing(null); }}
        onDelete={async () => {
          try { await api(`/api/applications?id=${editing.id}`, { method: "DELETE" }); setApps((xs) => xs!.filter((x) => x.id !== editing.id)); setEditing(null); }
          catch (e: any) { toast(e.message, true); }
        }} />}
    </>
  );
}

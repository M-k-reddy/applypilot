"use client";
import { useEffect, useState } from "react";
import { Page, useAuth } from "@/components/auth";
import { Alert, Button, Card, Empty, Field, Icon, Skeleton } from "@/components/ui";

const COLS: [string, string, string][] = [
  ["saved", "Saved", "var(--muted)"], ["filled", "Form filled", "var(--warn)"], ["applied", "Applied", "var(--accent)"],
  ["interview", "Interview", "#8b5cf6"], ["offer", "Offer", "var(--ok)"], ["rejected", "Closed", "var(--bad)"]
];

export default function TrackerPage() {
  const auth = useAuth();
  const [apps, setApps] = useState<any[] | null>(null);
  const [drag, setDrag] = useState<string | null>(null); const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState(""); const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({ title: "", company: "", url: "" });

  const load = () => auth.api("/api/applications").then((j) => setApps(j.applications || [])).catch((e) => { setErr(e.message); setApps([]); });
  useEffect(() => { if (auth.session) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [auth.session]);

  const move = async (id: string, status: string) => {
    setApps((a) => (a || []).map((x) => (x.id === id ? { ...x, status } : x)));
    try { await auth.api("/api/applications", { method: "POST", json: { id, status } }); } catch (e: any) { setErr(e.message); load(); }
  };
  const saveNotes = (id: string, notes: string) => auth.api("/api/applications", { method: "POST", json: { id, notes } }).catch((e) => setErr(e.message));
  const remove = async (id: string) => { await auth.api(`/api/applications?id=${id}`, { method: "DELETE" }); setApps((a) => (a || []).filter((x) => x.id !== id)); };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await auth.api("/api/applications", { method: "POST", json: { action: "save", source: "manual", job: manual } }); setManual({ title: "", company: "", url: "" }); setAdding(false); load(); }
    catch (er: any) { setErr(er.message); }
  };
  const count = (s: string) => (apps || []).filter((a) => a.status === s).length;

  return (
    <Page title="Tracker" sub="Drag cards between stages. The extension's Save job button adds cards to Saved." auth={auth}
      actions={<Button variant="primary" icon="plus" onClick={() => setAdding((v) => !v)}>Add job</Button>}>
      {err && <Alert>{err}</Alert>}
      {adding && <Card>
        <form className="grid grid-4" style={{ alignItems: "end" }} onSubmit={add}>
          <Field label="Role"><input required placeholder="e.g. SDE Intern" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></Field>
          <Field label="Company"><input placeholder="e.g. CRED" value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} /></Field>
          <Field label="Job link"><input placeholder="https://" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} /></Field>
          <div className="row"><Button type="submit">Save</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </form>
      </Card>}

      {apps !== null && apps.length > 0 && <div className="grid grid-4">
        {[["Saved", count("saved")], ["Applied", count("applied") + count("filled")], ["Interviews", count("interview")], ["Offers", count("offer")]].map(([l, v]) => (
          <div key={l} className="card stat" style={{ padding: 16 }}><span className="muted sm">{l}</span><span className="value">{v}</span></div>))}
      </div>}

      {apps === null ? <div className="kanban">{COLS.map(([k]) => <div key={k} className="col"><Skeleton h={16} w="60%" /><Skeleton h={90} /><Skeleton h={90} /></div>)}</div>
        : apps.length === 0 ? <Empty icon="board" title="Your board is empty" action={<Button icon="plus" onClick={() => setAdding(true)}>Add your first job</Button>}>Save jobs from the feed or with the extension, and they'll show up here.</Empty>
        : <div className="kanban">
          {COLS.map(([c, label, color]) => {
            const items = apps.filter((a) => a.status === c);
            return (
              <div key={c} className={`col ${over === c ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver(null)}
                onDrop={() => { if (drag) move(drag, c); setDrag(null); setOver(null); }}>
                <div className="col-head"><h4><span className="col-dot" style={{ background: color }} />{label}</h4><span className="muted xs">{items.length}</span></div>
                {items.length === 0 && <p className="muted xs" style={{ textAlign: "center", padding: "24px 0" }}>Drop here</p>}
                {items.map((a) => (
                  <div key={a.id} className={`kcard ${drag === a.id ? "dragging" : ""}`} draggable onDragStart={() => setDrag(a.id)} onDragEnd={() => setDrag(null)}>
                    <div><b>{a.title || "Untitled role"}</b><div className="muted xs" style={{ marginTop: 2 }}>{a.company || "—"}{a.location ? ` · ${a.location}` : ""}</div></div>
                    {a.notes && <p className="muted xs" style={{ whiteSpace: "pre-wrap" }}>{a.notes}</p>}
                    <details>
                      <summary className="muted xs" style={{ cursor: "pointer" }}>Edit</summary>
                      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                        <select value={a.status} onChange={(e) => move(a.id, e.target.value)} aria-label="Stage">{COLS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select>
                        <textarea defaultValue={a.notes || ""} placeholder="Notes" onBlur={(e) => { if (e.target.value !== (a.notes || "")) { const v = e.target.value; saveNotes(a.id, v); setApps((x) => (x || []).map((y) => (y.id === a.id ? { ...y, notes: v } : y))); } }} />
                      </div>
                    </details>
                    <div className="row between">
                      <span className="muted xs">{new Date(a.updated_at || a.created_at).toLocaleDateString()}</span>
                      <div className="row" style={{ gap: 4 }}>
                        {a.page_url && <a href={a.page_url} target="_blank" rel="noreferrer" className="btn sm ghost" aria-label="Open job"><Icon name="external" size={14} /></a>}
                        <button className="btn sm ghost" onClick={() => remove(a.id)} aria-label="Remove"><Icon name="trash" size={14} /></button>
                      </div>
                    </div>
                  </div>))}
              </div>);
          })}
        </div>}
    </Page>
  );
}

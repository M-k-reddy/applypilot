"use client";
import { useEffect, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Spinner } from "@/components/ui";

type Key = { id: string; name: string; prefix: string; created_at: string; last_used: string | null };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never");

export default function ExtensionPage() {
  const { api, toast } = useApp();
  const { busy, run } = useBusy();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [fresh, setFresh] = useState("");
  const [name, setName] = useState("Chrome on my laptop");
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); api<{ keys: Key[] }>("/api/keys").then((j) => setKeys(j.keys)).catch(() => setKeys([])); }, [api]);

  const create = () => run("create", async () => {
    const r = await api<{ key: string; record: Key }>("/api/keys", { method: "POST", json: { name } });
    setFresh(r.key); setKeys((k) => [r.record, ...(k || [])]);
  });
  const revoke = (id: string) => run(`rev:${id}`, async () => {
    if (!confirm("Revoke this key? The extension using it will stop working.")) return;
    await api(`/api/keys?id=${id}`, { method: "DELETE" }); setKeys((k) => (k || []).filter((x) => x.id !== id)); toast("Key revoked");
  });
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast("Copied ✓"); } catch { toast("Copy failed. Select and copy manually.", true); } };

  return (
    <>
      <PageHead title="Chrome extension" sub="Detect jobs on any site, save them, tailor in one click, and fill forms safely from the side panel." />
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>1 · Install</h3><span className="badge">Free</span></div>
          <ol className="small" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 8 }}>
            <li>Download or clone the ApplyPilot repository and find the <code>extension/</code> folder.</li>
            <li>Open <code>chrome://extensions</code> and switch on <b>Developer mode</b> (top right).</li>
            <li>Click <b>Load unpacked</b> and choose the <code>extension/</code> folder.</li>
            <li>Pin ApplyPilot, then click its icon to open the side panel.</li>
          </ol>
        </div>
        <div className="card">
          <div className="card-head"><h3>2 · Connect</h3></div>
          <p className="small">In the side panel, open <b>Settings</b> and paste:</p>
          <div className="field" style={{ marginBottom: 10 }}><span>API URL</span>
            <div className="row"><div className="codebox" style={{ flex: 1 }}>{origin || "…"}</div><button className="btn btn-sm" onClick={() => copy(origin)}>Copy</button></div>
          </div>
          <p className="small mb-0">…and an API key from below. Keys last until you revoke them.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div><h3>API keys</h3><p className="small muted mb-0">Each key is shown once. We only store a hash of it.</p></div>
          <div className="row">
            <label className="sr-only" htmlFor="kname">Key name</label>
            <input id="kname" className="input" style={{ width: 220 }} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <button className="btn btn-primary" onClick={create} disabled={!!busy}>{busy === "create" ? <Spinner /> : "Generate key"}</button>
          </div>
        </div>
        {fresh && (
          <div className="alert alert-ok" style={{ marginBottom: 14 }}>
            <b>Copy your key now. It will not be shown again.</b>
            <div className="row" style={{ marginTop: 8 }}><div className="codebox" style={{ flex: 1 }}>{fresh}</div><button className="btn btn-sm" onClick={() => copy(fresh)}>Copy key</button></div>
          </div>
        )}
        {keys === null ? <div className="skeleton" style={{ height: 80 }} /> : keys.length === 0 ? <p className="muted small mb-0">No active keys yet.</p> : (
          <div className="table-scroll"><table className="table">
            <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id}><td>{k.name}</td><td><code>{k.prefix}…</code></td><td>{fmt(k.created_at)}</td><td>{fmt(k.last_used)}</td>
                <td><button className="btn btn-sm btn-ghost btn-danger" onClick={() => revoke(k.id)} disabled={!!busy}>Revoke</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>What the extension will and won&apos;t do</h3>
        <div className="grid grid-2 small">
          <ul style={{ paddingLeft: 18, margin: 0 }}><li>Runs only when you click it, on the tab you are looking at.</li><li>Fills fields in <b style={{ color: "#2ecc71" }}>green</b>, leaves questions for you in <b style={{ color: "#ff9f1c" }}>orange</b>.</li><li>Outlines the Next/Submit button in <b style={{ color: "#4f7cff" }}>blue</b> for you to click.</li></ul>
          <ul style={{ paddingLeft: 18, margin: 0 }}><li>Never clicks Submit.</li><li>Never fills salary, personal or legal questions.</li><li>Skips password and hidden fields. CAPTCHAs and OTPs stay with you.</li></ul>
        </div>
      </div>
    </>
  );
}

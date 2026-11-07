"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Spinner } from "@/components/ui";
import { AUTO_PRESETS, applyPatch, describePlan, type AutoPreset } from "@/lib/autoPresets";
import type { AutoSettings } from "@/lib/autosettings";

type BoardId = "naukri" | "internshala" | "indeed" | "foundit";
type Settings = AutoSettings;
type Msg = { who: "me" | "bot"; text: string; chips?: boolean };
type Status = Record<string, { connected: boolean | null; checked_at: string }>;
type Data = { settings: Settings; board_status: Status; today: { applied: number; needs_review: number }; unanswered: { q: string; seen?: string }[] };

const BOARDS: { id: BoardId | "linkedin"; name: string; login: string }[] = [
  { id: "naukri", name: "Naukri", login: "https://www.naukri.com/nlogin/login" },
  { id: "internshala", name: "Internshala", login: "https://internshala.com/login/user" },
  { id: "indeed", name: "Indeed India", login: "https://secure.indeed.com/auth?hl=en_IN&co=IN" },
  { id: "foundit", name: "Foundit", login: "https://www.foundit.in/rio/login" },
  { id: "linkedin", name: "LinkedIn", login: "" }
];
const fmt = (d: string) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

export default function AutoApplyPage() {
  const { api, toast } = useApp();
  const { busy, run } = useBusy();
  const [d, setD] = useState<Data | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [ans, setAns] = useState<Record<string, string>>({});
  const load = useCallback(() => api<Data>("/api/auto/settings").then((j) => { setD(j); setS(j.settings); }).catch((e) => toast(e.message, true)), [api, toast]);
  useEffect(() => { load(); }, [load]);

  const save = () => run("save", async () => {
    const r = await api<{ settings: Settings }>("/api/auto/settings", { method: "PUT", json: { settings: s } });
    setS(r.settings); toast("Settings saved ✓ The extension picks them up before its next run.");
  });
  const answer = (q: string) => run(`a:${q}`, async () => {
    const a = (ans[q] || "").trim(); if (!a) { toast("Type an answer first.", true); return; }
    await api("/api/answers", { method: "POST", json: { answers: [{ q, a }] } });
    setD((x) => (x ? { ...x, unanswered: x.unanswered.filter((u) => u.q !== q) } : x)); toast("Saved to your answer bank ✓");
  });
  // Auto-apply assistant: short chat history kept in local state only.
  const [chat, setChat] = useState<Msg[]>([{ who: "bot", text: "Hi! Pick a plan or type one, like \"10 python jobs in hyderabad\".", chips: true }]);
  const [msg, setMsg] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [chat]);
  const say = (m: Msg) => setChat((c) => [...c, m].slice(-20));
  const saved = (st: Settings) => { setS(st); setD((x) => (x ? { ...x, settings: st } : x)); };
  const preset = (p: AutoPreset) => run(`p:${p.id}`, async () => {
    if (!d) return;
    say({ who: "me", text: p.label });
    try {
      const r = await api<{ settings: Settings }>("/api/auto/settings", { method: "PUT", json: { settings: applyPatch(d.settings, p.patch) } });
      saved(r.settings); say({ who: "bot", text: describePlan(r.settings, p.patch.daily_cap) });
    } catch (e: any) { say({ who: "bot", text: `Sorry, that didn't save: ${e.message}` }); }
  });
  const ask = () => run("ask", async () => {
    const t = msg.trim(); if (!t) return;
    setMsg(""); say({ who: "me", text: t });
    try {
      const r = await api<{ ok: boolean; reply: string; settings?: Settings }>("/api/auto/assistant", { method: "POST", json: { text: t } });
      if (r.ok && r.settings) saved(r.settings);
      say({ who: "bot", text: r.reply, chips: !r.ok });
    } catch (e: any) { say({ who: "bot", text: `Sorry, that didn't work: ${e.message}`, chips: true }); }
  });
  const chips = (
    <div className="chips" style={{ marginTop: 8 }}>
      {AUTO_PRESETS.map((p) => <button key={p.id} className="chip" style={{ cursor: "pointer" }} onClick={() => preset(p)} disabled={!!busy}>{busy === `p:${p.id}` ? <Spinner /> : p.label}</button>)}
    </div>
  );
  const setBoard = (id: BoardId, p: Partial<{ on: boolean; cap: number }>) => setS((x) => (x ? { ...x, boards: { ...x.boards, [id]: { ...x.boards[id], ...p } } } : x));

  if (!d || !s) return <><PageHead title="Auto-apply" /><div className="skeleton" style={{ height: 200 }} /></>;
  return (
    <>
      <PageHead title="Auto-apply" sub="Zero-click: once a day the extension applies to the jobs Naukri, Internshala, Indeed and Foundit recommend for you, inside your signed-in Chrome. Chrome just needs to be open." />
      <div className="grid grid-2">
        <div className="card"><div className="card-head"><h3>Applied today</h3></div><div style={{ fontSize: "2rem", fontWeight: 800 }}>{d.today.applied}</div></div>
        <div className="card"><div className="card-head"><h3>Needs review today</h3><Link className="btn btn-sm" href="/dashboard/tracker">Open tracker</Link></div><div style={{ fontSize: "2rem", fontWeight: 800 }}>{d.today.needs_review}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Auto-apply assistant</h3><span className={`badge ${s.enabled ? "badge-ok" : ""}`}>{s.enabled ? `On · ${s.daily_cap}/day at ${s.run_time} IST` : "Paused"}</span></div>
        <div className="stack" style={{ gap: 8, maxHeight: 360, overflowY: "auto" }}>
          {chat.map((m, i) => (
            <div key={i} style={{ alignSelf: m.who === "me" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              <div className="small" style={{ padding: "8px 12px", borderRadius: 14, background: m.who === "me" ? "var(--brand-soft)" : "var(--bg-2)", border: "1px solid var(--border)" }}>{m.text}</div>
              {m.chips && chips}
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <input className="input" style={{ flex: 1 }} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="e.g. 10 python jobs in hyderabad" />
          <button className="btn btn-primary" type="submit" disabled={!!busy || !msg.trim()}>{busy === "ask" ? <Spinner /> : "Send"}</button>
        </form>
      </div>

      <div className="card">
        <div className="card-head"><h3>1 · Install the extension</h3><Link className="btn btn-sm" href="/dashboard/extension">Extension &amp; API key</Link></div>
        <p className="small mb-0">Load the ApplyPilot extension (v2.4+), paste your API key in its Settings, and switch on <b>Auto mode</b> in its Auto tab once. That switch is the local safety gate; everything else is set here.</p>
      </div>

      <div className="card">
        <div className="card-head"><h3>2 · Connect boards</h3><button className="btn btn-sm" onClick={load}>Refresh</button></div>
        <p className="small muted">Sign in to each board in the same Chrome the extension runs in. ApplyPilot never sees or stores your board passwords; the extension reports whether you are signed in before each run.</p>
        <div className="stack" style={{ gap: 8 }}>
          {BOARDS.map((b) => {
            const st = b.id === "linkedin" ? undefined : d.board_status[b.id];
            return (
              <div key={b.id} className="row between">
                <b>{b.name}</b>
                {b.id === "linkedin" ? <span className="badge">Not supported (LinkedIn&apos;s terms)</span>
                  : st?.connected === true ? <span className="badge badge-ok" title={fmt(st.checked_at)}>Connected ✓ · checked {fmt(st.checked_at)}</span>
                  : <span className="row"><span className={`badge ${st?.connected === false ? "badge-warn" : ""}`}>{st?.connected === false ? "Not signed in" : "Not checked yet"}</span>
                      <a className="btn btn-sm" href={b.login} target="_blank" rel="noreferrer">Sign in on {b.name} in Chrome</a></span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>3 · Settings</h3><button className="btn btn-primary" onClick={save} disabled={!!busy}>{busy === "save" ? <Spinner /> : "Save settings"}</button></div>
        <div className="stack">
          <label className="row"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> <span><b>Run automatically every day</b> (no click needed; if Chrome opens later, it catches up that day)</span></label>
          <div className="row">
            <label className="field"><span>Run time (IST)</span><input className="input" type="time" value={s.run_time} onChange={(e) => setS({ ...s, run_time: e.target.value || "09:00" })} /></label>
            <label className="field"><span>Daily cap (all boards)</span><input className="input" type="number" min={1} max={200} value={s.daily_cap} onChange={(e) => setS({ ...s, daily_cap: Number(e.target.value) })} style={{ width: 110 }} /></label>
            <label className="field"><span>Min match % (0 = off)</span><input className="input" type="number" min={0} max={100} step={5} value={s.min_match} onChange={(e) => setS({ ...s, min_match: Number(e.target.value) })} style={{ width: 110 }} /></label>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>Roles / keywords (comma-separated, empty = all)</span><input className="input" value={s.roles.join(", ")} onChange={(e) => setS({ ...s, roles: e.target.value.split(",").map((x) => x.trimStart()) })} placeholder="python, data analyst" /></label>
            <label className="field" style={{ flex: 1 }}><span>Locations (comma-separated, empty = any)</span><input className="input" value={s.locations.join(", ")} onChange={(e) => setS({ ...s, locations: e.target.value.split(",").map((x) => x.trimStart()) })} placeholder="hyderabad, remote" /></label>
          </div>
          {(["naukri", "internshala", "indeed", "foundit"] as BoardId[]).map((id) => (
            <div key={id} className="row between">
              <label className="row"><input type="checkbox" checked={s.boards[id].on} onChange={(e) => setBoard(id, { on: e.target.checked })} /> {BOARDS.find((b) => b.id === id)!.name}</label>
              <label className="row small">Cap/day <input className="input" type="number" min={1} max={100} value={s.boards[id].cap} onChange={(e) => setBoard(id, { cap: Number(e.target.value) })} style={{ width: 90 }} /></label>
            </div>
          ))}
          <p className="tiny muted mb-0">Same safety gates as always: 25–75 s between applications, stops on CAPTCHA, sign-in wall or limit messages, unsure answers go to Needs review, LinkedIn never.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Questions waiting for your answer</h3><span className="badge">{d.unanswered.length}</span></div>
        {!d.unanswered.length ? <p className="muted small mb-0">None. Questions the runner could not answer will show up here.</p> : (
          <div className="stack">
            {d.unanswered.map((u) => (
              <div key={u.q} className="stack" style={{ gap: 6 }}>
                <span className="small"><b>{u.q}</b></span>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} value={ans[u.q] || ""} onChange={(e) => setAns((a) => ({ ...a, [u.q]: e.target.value }))} placeholder="Your answer (saved to your answer bank)" maxLength={2000} />
                  <button className="btn btn-sm" onClick={() => answer(u.q)} disabled={!!busy}>{busy === `a:${u.q}` ? <Spinner /> : "Save"}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

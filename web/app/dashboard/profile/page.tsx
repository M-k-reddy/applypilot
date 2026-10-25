"use client";
import { useEffect, useRef, useState } from "react";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Spinner } from "@/components/ui";
import { ANSWER_FIELDS, emptyProfile, normalizeProfile, type Profile } from "@/lib/profile";

const lines = (a: string[]) => a.join("\n");
const fromLines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const fromCsv = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

function Text({ label, value, onChange, type = "text", placeholder, wide }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; wide?: boolean }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}><span>{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Area({ label, value, onChange, rows = 4, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  return (
    <label className="field" style={{ gridColumn: "1 / -1" }}><span>{label}</span>
      <textarea className="textarea" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <small className="help">{hint}</small>}
    </label>
  );
}

export default function ProfilePage() {
  const { api, toast, refreshMe } = useApp();
  const { busy, run } = useBusy();
  const [p, setP] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [csv, setCsv] = useState({ skills: "", certifications: "" });
  const file = useRef<HTMLInputElement>(null);

  const load = (prof: Profile) => { setP(prof); setCsv({ skills: prof.skills.join(", "), certifications: prof.certifications.join(", ") }); setDirty(false); };
  useEffect(() => { api<{ profile: Profile }>("/api/profile").then((j) => load(normalizeProfile(j.profile))).catch(() => load(emptyProfile())); }, [api]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (!p) return <><PageHead title="Profile" /><div className="skeleton" style={{ height: 400 }} /></>;

  const set = (patch: Partial<Profile>) => { setP({ ...p, ...patch }); setDirty(true); };
  const setAns = (k: keyof Profile["answers"], v: string) => set({ answers: { ...p.answers, [k]: v } });
  const upd = <K extends "education" | "experience" | "projects" | "answer_bank">(key: K, i: number, patch: Partial<Profile[K][number]>) =>
    set({ [key]: (p[key] as any[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) } as Partial<Profile>);
  const del = (key: "education" | "experience" | "projects" | "answer_bank", i: number) => set({ [key]: (p[key] as any[]).filter((_, j) => j !== i) } as Partial<Profile>);

  const upload = (f: File) => run("upload", async () => {
    if (f.type !== "application/pdf") throw new Error("Please choose a PDF file.");
    if (f.size > 5 * 1024 * 1024) throw new Error("Max file size is 5 MB.");
    const fd = new FormData(); fd.append("file", f);
    const j = await api<{ profile: Profile }>("/api/resume", { method: "POST", body: fd });
    load(normalizeProfile(j.profile)); toast("Resume parsed. Review the details below and save."); refreshMe();
  });

  const save = () => run("save", async () => {
    const body = { ...p, skills: fromCsv(csv.skills), certifications: fromCsv(csv.certifications) };
    const j = await api<{ profile: Profile }>("/api/profile", { method: "PUT", json: { profile: body } });
    load(normalizeProfile(j.profile)); toast("Profile saved ✓"); refreshMe();
  });

  return (
    <>
      <PageHead title="Profile & answers" sub="Everything here is used as the only source of truth for tailoring, cover letters and autofill.">
        <input ref={file} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        <button className="btn" onClick={() => file.current?.click()} disabled={!!busy}>{busy === "upload" ? <Spinner label="Parsing your resume…" /> : "⇪ Upload resume PDF"}</button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy || !dirty}>{busy === "save" ? <Spinner label="Saving…" /> : dirty ? "Save changes" : "Saved"}</button>
      </PageHead>

      {!p.full_name && !p.experience.length && !p.projects.length && (
        <div className="alert" style={{ marginBottom: 16 }}>Start by uploading a text-based resume PDF. AI fills the form below, and you can fix anything before saving.</div>
      )}

      <div className="card">
        <div className="card-head"><h3>Basics</h3></div>
        <div className="grid grid-2">
          <Text label="Full name" value={p.full_name} onChange={(v) => set({ full_name: v })} />
          <Text label="Headline" value={p.headline} onChange={(v) => set({ headline: v })} placeholder="B.Tech CSE '26 · React & Python" />
          <Text label="Email" type="email" value={p.email} onChange={(v) => set({ email: v })} />
          <Text label="Phone" type="tel" value={p.phone} onChange={(v) => set({ phone: v })} placeholder="+91 98765 43210" />
          <Text label="Location" value={p.location} onChange={(v) => set({ location: v })} placeholder="Hyderabad, Telangana" />
          <Text label="LinkedIn" value={p.linkedin} onChange={(v) => set({ linkedin: v })} />
          <Text label="GitHub" value={p.github} onChange={(v) => set({ github: v })} />
          <Text label="Portfolio" value={p.portfolio} onChange={(v) => set({ portfolio: v })} />
          <Area label="Summary" value={p.summary} onChange={(v) => set({ summary: v })} rows={3} />
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Skills (comma separated)</span>
            <textarea className="textarea" rows={2} value={csv.skills} onChange={(e) => { setCsv({ ...csv, skills: e.target.value }); setDirty(true); }} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Education</h3><button className="btn btn-sm" onClick={() => set({ education: [...p.education, { degree: "", field: "", institution: "", start: "", end: "", grade: "" }] })}>+ Add</button></div>
        {p.education.length === 0 && <p className="muted small">No education added yet.</p>}
        {p.education.map((e, i) => (
          <div key={i} className="grid grid-3" style={{ padding: "14px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
            <Text label="Degree" value={e.degree} onChange={(v) => upd("education", i, { degree: v })} placeholder="B.Tech" />
            <Text label="Field" value={e.field} onChange={(v) => upd("education", i, { field: v })} placeholder="Computer Science" />
            <Text label="Institution" value={e.institution} onChange={(v) => upd("education", i, { institution: v })} />
            <Text label="Start" value={e.start} onChange={(v) => upd("education", i, { start: v })} />
            <Text label="End" value={e.end} onChange={(v) => upd("education", i, { end: v })} />
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><Text label="CGPA / %" value={e.grade} onChange={(v) => upd("education", i, { grade: v })} /></div>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => del("education", i)} aria-label={`Remove education ${i + 1}`}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><h3>Experience & internships</h3><button className="btn btn-sm" onClick={() => set({ experience: [...p.experience, { title: "", company: "", location: "", start: "", end: "", bullets: [] }] })}>+ Add</button></div>
        {p.experience.length === 0 && <p className="muted small">No experience yet. That is fine for freshers: projects count too.</p>}
        {p.experience.map((e, i) => (
          <div key={i} className="grid grid-3" style={{ padding: "14px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
            <Text label="Title" value={e.title} onChange={(v) => upd("experience", i, { title: v })} />
            <Text label="Company" value={e.company} onChange={(v) => upd("experience", i, { company: v })} />
            <Text label="Location" value={e.location} onChange={(v) => upd("experience", i, { location: v })} />
            <Text label="Start" value={e.start} onChange={(v) => upd("experience", i, { start: v })} />
            <Text label="End" value={e.end} onChange={(v) => upd("experience", i, { end: v })} placeholder="Present" />
            <div className="row" style={{ alignItems: "flex-end" }}><button className="btn btn-sm btn-ghost btn-danger" onClick={() => del("experience", i)}>Remove</button></div>
            <Area label="Bullets (one per line)" value={lines(e.bullets)} onChange={(v) => upd("experience", i, { bullets: v.split("\n") })} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><h3>Projects</h3><button className="btn btn-sm" onClick={() => set({ projects: [...p.projects, { name: "", tech: [], bullets: [], link: "" }] })}>+ Add</button></div>
        {p.projects.length === 0 && <p className="muted small">Add 2–3 projects. They matter most for fresher roles.</p>}
        {p.projects.map((x, i) => (
          <div key={i} className="grid grid-3" style={{ padding: "14px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
            <Text label="Name" value={x.name} onChange={(v) => upd("projects", i, { name: v })} />
            <Text label="Tech (comma separated)" value={x.tech.join(", ")} onChange={(v) => upd("projects", i, { tech: fromCsv(v) })} />
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><Text label="Link" value={x.link} onChange={(v) => upd("projects", i, { link: v })} /></div>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => del("projects", i)}>Remove</button>
            </div>
            <Area label="Bullets (one per line)" value={lines(x.bullets)} onChange={(v) => upd("projects", i, { bullets: v.split("\n") })} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><h3>More</h3></div>
        <div className="grid grid-2">
          <label className="field"><span>Certifications (comma separated)</span>
            <input className="input" value={csv.certifications} onChange={(e) => { setCsv({ ...csv, certifications: e.target.value }); setDirty(true); }} />
          </label>
          <Text label="Total experience (years)" type="number" value={String(p.total_experience_years)} onChange={(v) => set({ total_experience_years: Number(v) || 0 })} />
          <Area label="Achievements (one per line)" value={lines(p.achievements)} onChange={(v) => set({ achievements: v.split("\n") })} rows={3} />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h3>Common answers</h3><p className="small muted mb-0">Used by autofill. Salary fields are for quick copy only: autofill always leaves salary questions to you.</p></div></div>
        <div className="grid grid-2">
          {ANSWER_FIELDS.map((f) => <Text key={f.key} label={f.label} value={p.answers[f.key]} placeholder={f.hint} onChange={(v) => setAns(f.key, v)} />)}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><h3>Answer bank</h3><p className="small muted mb-0">Saved Q&A, reused when a form asks the same thing. The extension adds to this when you click “Save my answers”.</p></div>
          <button className="btn btn-sm" onClick={() => set({ answer_bank: [...p.answer_bank, { q: "", a: "" }] })}>+ Add Q&A</button>
        </div>
        {p.answer_bank.length === 0 && <p className="muted small">No saved answers yet. Try “Why do you want to join us?” or “Are you comfortable with night shifts?”.</p>}
        {p.answer_bank.map((x, i) => (
          <div key={i} className="grid grid-2" style={{ padding: "12px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
            <Text label="Question" value={x.q} onChange={(v) => upd("answer_bank", i, { q: v })} />
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: 1 }}><span>Answer</span><textarea className="textarea" rows={2} style={{ minHeight: 44 }} value={x.a} onChange={(e) => upd("answer_bank", i, { a: e.target.value })} /></label>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => del("answer_bank", i)} aria-label={`Remove answer ${i + 1}`}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {dirty && <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!!busy} style={{ boxShadow: "var(--shadow-lg)" }}>{busy === "save" ? <Spinner label="Saving…" /> : "Save changes"}</button>
      </div>}
    </>
  );
}

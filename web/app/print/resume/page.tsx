"use client";
import { useEffect, useState } from "react";
import { normalizeProfile, type Profile } from "@/lib/profile";

// Clean, single-column, ATS-friendly resume. Data comes from the Tailor page via localStorage (same origin).
// "Download PDF" uses the browser's own print-to-PDF: no paid PDF service.
export default function PrintResume() {
  const [data, setData] = useState<{ profile: Profile; job?: { title: string; company: string } } | null | undefined>(undefined);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ap-print");
      if (!raw) return setData(null);
      const j = JSON.parse(raw);
      setData({ profile: normalizeProfile(j.profile), job: j.job });
      document.title = `${j.profile?.full_name || "Resume"}${j.job?.company ? " - " + j.job.company : ""}`;
    } catch { setData(null); }
  }, []);
  useEffect(() => { if (data) { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t); } }, [data]);

  if (data === undefined) return null;
  if (!data) return <div className="auth-wrap"><div className="auth-card"><h2>Nothing to print</h2><p className="muted">Open a job in Tailor and click “Export ATS-friendly PDF”.</p><a className="btn btn-primary" href="/dashboard/tailor">Go to Tailor</a></div></div>;
  const p = data.profile;
  const contact = [p.location, p.phone, p.email, p.linkedin, p.github, p.portfolio].filter(Boolean);

  return (
    <>
      <div className="print-bar no-print">
        <button className="btn btn-primary" onClick={() => window.print()}>⤓ Download PDF</button>
        <button className="btn" onClick={() => window.close()}>Close</button>
        <span className="small muted" style={{ alignSelf: "center" }}>In the print dialog choose “Save as PDF”, paper A4, margins Default.</span>
      </div>
      <article className="resume-sheet">
        <h1>{p.full_name || "Your Name"}</h1>
        {p.headline && <div style={{ fontWeight: 600 }}>{p.headline}</div>}
        <div className="contact">{contact.join("  |  ")}</div>

        {p.summary && <><h2>Summary</h2><p style={{ margin: 0 }}>{p.summary}</p></>}

        {p.skills.length > 0 && <><h2>Skills</h2><p style={{ margin: 0 }}>{p.skills.join(", ")}</p></>}

        {p.experience.length > 0 && <><h2>Experience</h2>{p.experience.map((e, i) => (
          <div className="item" key={i}>
            <div className="item-head"><span>{e.title}{e.company ? `, ${e.company}` : ""}</span><span>{[e.start, e.end].filter(Boolean).join(" – ")}</span></div>
            {e.location && <div className="item-sub">{e.location}</div>}
            {e.bullets.length > 0 && <ul>{e.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
          </div>))}</>}

        {p.projects.length > 0 && <><h2>Projects</h2>{p.projects.map((x, i) => (
          <div className="item" key={i}>
            <div className="item-head"><span>{x.name}{x.tech.length ? ` | ${x.tech.join(", ")}` : ""}</span>{x.link && <span style={{ fontWeight: 400 }}>{x.link}</span>}</div>
            {x.bullets.length > 0 && <ul>{x.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
          </div>))}</>}

        {p.education.length > 0 && <><h2>Education</h2>{p.education.map((e, i) => (
          <div className="item" key={i}>
            <div className="item-head"><span>{[e.degree, e.field].filter(Boolean).join(", ")}</span><span>{[e.start, e.end].filter(Boolean).join(" – ")}</span></div>
            <div>{e.institution}{e.grade ? ` | ${e.grade}` : ""}</div>
          </div>))}</>}

        {p.certifications.length > 0 && <><h2>Certifications</h2><ul>{p.certifications.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
        {p.achievements.length > 0 && <><h2>Achievements</h2><ul>{p.achievements.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
      </article>
    </>
  );
}

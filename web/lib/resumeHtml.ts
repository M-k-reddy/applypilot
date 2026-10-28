import { esc } from "./text";

/** Tailored resume shape (subset of RESUME_SCHEMA plus a target title). */
export type TailoredResume = {
  full_name: string; headline: string; email: string; phone: string; location: string;
  linkedin?: string; github?: string; portfolio?: string; summary: string;
  skills: string[];
  experience: { title: string; company: string; start: string; end: string; bullets: string[] }[];
  projects: { name: string; tech: string[]; bullets: string[]; link?: string }[];
  education: { degree: string; field: string; institution: string; start: string; end: string; grade: string }[];
  achievements: string[]; certifications: string[];
};

const link = (u?: string) => (u ? `<a href="${esc(/^https?:/.test(u) ? u : "https://" + u)}">${esc(u.replace(/^https?:\/\//, ""))}</a>` : "");
const range = (a?: string, b?: string) => [a, b].filter(Boolean).map(esc).join(" – ");

/**
 * ATS-safe, single-column, print-ready HTML. No tables, no columns, no icons, real text only.
 * The page includes print CSS so the browser's "Save as PDF" gives a clean A4/Letter page.
 */
export function renderResumeHtml(r: TailoredResume): string {
  const contact = [esc(r.email), esc(r.phone), esc(r.location), link(r.linkedin), link(r.github), link(r.portfolio)].filter(Boolean).join(" · ");
  const section = (title: string, body: string) => (body.trim() ? `<h2>${title}</h2>${body}` : "");
  const bullets = (bs: string[]) => (bs?.length ? `<ul>${bs.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "");
  const exp = (r.experience || []).map((e) =>
    `<div class="item"><div class="row"><b>${esc(e.title)}</b>, ${esc(e.company)}<span class="date">${range(e.start, e.end)}</span></div>${bullets(e.bullets)}</div>`).join("");
  const proj = (r.projects || []).map((p) =>
    `<div class="item"><div class="row"><b>${esc(p.name)}</b>${p.tech?.length ? ` | ${esc(p.tech.join(", "))}` : ""}${p.link ? ` · ${link(p.link)}` : ""}</div>${bullets(p.bullets)}</div>`).join("");
  const edu = (r.education || []).map((e) =>
    `<div class="item"><div class="row"><b>${esc([e.degree, e.field].filter(Boolean).join(" in "))}</b>, ${esc(e.institution)}<span class="date">${range(e.start, e.end)}</span></div>${e.grade ? `<div>${esc(e.grade)}</div>` : ""}</div>`).join("");
  const extra = [...(r.achievements || []), ...(r.certifications || [])];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.full_name)} – Resume</title>
<style>
@page{size:A4;margin:14mm 15mm}
body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10.5pt;line-height:1.35;max-width:780px;margin:24px auto;padding:0 16px}
h1{font-size:20pt;margin:0}.headline{font-size:11pt;margin:2px 0 4px}.contact{font-size:9.5pt;margin-bottom:8px}
h2{font-size:11pt;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #444;margin:12px 0 4px;padding-bottom:2px}
ul{margin:2px 0 6px 18px;padding:0}li{margin:1px 0}.item{margin-bottom:4px}.date{float:right;font-size:9.5pt}
a{color:#111;text-decoration:none}.noprint{position:fixed;top:10px;right:10px}
@media print{.noprint{display:none}body{margin:0;padding:0}}
</style></head><body>
<button class="noprint" onclick="window.print()">Save as PDF</button>
<h1>${esc(r.full_name)}</h1>
${r.headline ? `<div class="headline">${esc(r.headline)}</div>` : ""}
<div class="contact">${contact}</div>
${section("Summary", r.summary ? `<p style="margin:2px 0">${esc(r.summary)}</p>` : "")}
${section("Skills", r.skills?.length ? `<p style="margin:2px 0">${esc(r.skills.join(", "))}</p>` : "")}
${section("Experience", exp)}
${section("Projects", proj)}
${section("Education", edu)}
${section("Achievements", bullets(extra))}
</body></html>`;
}

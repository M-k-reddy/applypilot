// Shared profile types + a strict normaliser used for both AI output and user edits.
// Safe to import from client and server.

export type Education = { degree: string; field: string; institution: string; start: string; end: string; grade: string };
export type Experience = { title: string; company: string; location: string; start: string; end: string; bullets: string[] };
export type Project = { name: string; tech: string[]; bullets: string[]; link: string };
export type QA = { q: string; a: string };
export type Answers = {
  work_authorization_india: string; notice_period: string; willing_to_relocate: string;
  expected_ctc: string; current_ctc: string; available_from: string; preferred_locations: string;
  graduation_year: string; languages: string;
};
export type Profile = {
  full_name: string; email: string; phone: string; location: string;
  linkedin: string; github: string; portfolio: string; headline: string; summary: string;
  total_experience_years: number;
  education: Education[]; experience: Experience[]; projects: Project[];
  skills: string[]; certifications: string[]; achievements: string[];
  answers: Answers; answer_bank: QA[];
};

export const ANSWER_FIELDS: { key: keyof Answers; label: string; hint: string }[] = [
  { key: "work_authorization_india", label: "Work authorisation (India)", hint: "e.g. Indian citizen, no sponsorship needed" },
  { key: "notice_period", label: "Notice period", hint: "e.g. Immediate joiner" },
  { key: "willing_to_relocate", label: "Willing to relocate?", hint: "e.g. Yes, anywhere in India" },
  { key: "available_from", label: "Available from", hint: "e.g. June 2026" },
  { key: "preferred_locations", label: "Preferred locations", hint: "e.g. Hyderabad, Bengaluru, Remote" },
  { key: "graduation_year", label: "Graduation year", hint: "e.g. 2026" },
  { key: "languages", label: "Languages", hint: "e.g. English, Hindi, Telugu" },
  { key: "expected_ctc", label: "Expected CTC (quick-copy only)", hint: "Never auto-filled; you always answer salary yourself" },
  { key: "current_ctc", label: "Current CTC (quick-copy only)", hint: "Never auto-filled" }
];

const s = (v: unknown, max = 600) => (typeof v === "string" ? v : v == null ? "" : String(v)).replace(/\u0000/g, "").trim().slice(0, max);
const arr = <T>(v: unknown, f: (x: any) => T, max = 40): T[] => (Array.isArray(v) ? v.slice(0, max).map(f) : []);
const strs = (v: unknown, max = 60, len = 400) =>
  (typeof v === "string" ? v.split(/[,\n]/) : Array.isArray(v) ? v : []).map((x) => s(x, len)).filter(Boolean).slice(0, max);

export function emptyProfile(): Profile { return normalizeProfile({}); }

export function normalizeProfile(p: any): Profile {
  p = p && typeof p === "object" ? p : {};
  const a = p.answers && typeof p.answers === "object" ? p.answers : {};
  return {
    full_name: s(p.full_name, 120), email: s(p.email, 160), phone: s(p.phone, 40), location: s(p.location, 120),
    linkedin: s(p.linkedin, 300), github: s(p.github, 300), portfolio: s(p.portfolio, 300),
    headline: s(p.headline, 200), summary: s(p.summary, 1500),
    total_experience_years: Math.max(0, Math.min(60, Number(p.total_experience_years) || 0)),
    education: arr(p.education, (e) => ({ degree: s(e?.degree, 160), field: s(e?.field, 160), institution: s(e?.institution, 200), start: s(e?.start, 30), end: s(e?.end, 30), grade: s(e?.grade, 40) }), 10),
    experience: arr(p.experience, (e) => ({ title: s(e?.title, 160), company: s(e?.company, 160), location: s(e?.location, 120), start: s(e?.start, 30), end: s(e?.end, 30), bullets: strs(e?.bullets, 12, 500) }), 15),
    projects: arr(p.projects, (e) => ({ name: s(e?.name, 160), tech: strs(e?.tech, 20, 60), bullets: strs(e?.bullets, 10, 500), link: s(e?.link, 300) }), 15),
    skills: strs(p.skills, 80, 60), certifications: strs(p.certifications, 30, 200), achievements: strs(p.achievements, 30, 300),
    answers: {
      work_authorization_india: s(a.work_authorization_india, 200), notice_period: s(a.notice_period, 120),
      willing_to_relocate: s(a.willing_to_relocate, 200), expected_ctc: s(a.expected_ctc, 80), current_ctc: s(a.current_ctc, 80),
      available_from: s(a.available_from, 80), preferred_locations: s(a.preferred_locations, 200),
      graduation_year: s(a.graduation_year, 10), languages: s(a.languages, 200)
    },
    answer_bank: arr(p.answer_bank, (x) => ({ q: s(x?.q, 300), a: s(x?.a, 2000) }), 200).filter((x) => x.q && x.a)
  };
}

/** Flatten a profile into plain text (for ATS scoring and fact checks). */
export function profileText(p: Profile): string {
  return [
    p.headline, p.summary, p.skills.join(", "), p.certifications.join(", "), p.achievements.join(". "),
    ...p.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...p.projects.flatMap((x) => [x.name, x.tech.join(", "), ...x.bullets]),
    ...p.education.flatMap((e) => [e.degree, e.field, e.institution])
  ].filter(Boolean).join("\n");
}

/** The profile without salary data and contact noise, for AI prompts that do not need them. */
export function promptProfile(p: Profile) {
  const { answers, answer_bank, ...rest } = p;
  const { expected_ctc, current_ctc, ...safeAnswers } = answers;
  void expected_ctc; void current_ctc; void answer_bank;
  return { ...rest, answers: safeAnswers };
}

// ───────── Tailoring
export type TailorEdit = { id: string; section: "summary" | "experience" | "projects"; item: number; bullet: number; old: string; new: string; reason: string; warnings: string[] };
export type Tailored = { generatedAt: string; keywords: string[]; edits: TailorEdit[]; decisions: Record<string, string>; overrides: Record<string, string> };

/** Apply accepted edits (with any user overrides) to a copy of the profile. */
export function applyEdits(p: Profile, t: Tailored | null | undefined): Profile {
  const out: Profile = JSON.parse(JSON.stringify(p));
  if (!t) return out;
  for (const e of t.edits || []) {
    if (t.decisions?.[e.id] !== "accepted") continue;
    const text = (t.overrides?.[e.id] ?? e.new).trim();
    if (!text) continue;
    if (e.section === "summary") out.summary = text;
    else if (e.section === "experience" && out.experience[e.item]?.bullets[e.bullet] != null) out.experience[e.item].bullets[e.bullet] = text;
    else if (e.section === "projects" && out.projects[e.item]?.bullets[e.bullet] != null) out.projects[e.item].bullets[e.bullet] = text;
  }
  return out;
}

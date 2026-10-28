import { extractSkills, skillGap, topTerms } from "./skills";
import { escapeRegExp } from "./text";

/**
 * Deterministic ATS checks. Pure TypeScript, no AI, so results are repeatable and free.
 * Each check has a weight; the score is the weighted share of passed checks, out of 100.
 * JD-dependent checks are only included when a job description is supplied.
 */
export type AtsCheck = {
  id: string; category: "contact" | "sections" | "content" | "keywords" | "format";
  label: string; pass: boolean; weight: number; detail: string; tip: string;
};
export type AtsReport = {
  score: number; grade: "excellent" | "good" | "needs work" | "poor";
  checks: AtsCheck[]; stats: Record<string, number>;
  keywords?: { matched: string[]; missing: string[]; coverage: number };
  weak_bullets: string[];
};

const ACTION_VERBS = ("achieved accelerated analyzed architected automated built collaborated conducted configured created debugged decreased deployed " +
  "designed developed devised drove enabled engineered enhanced established evaluated executed expanded fine-tuned generated implemented improved " +
  "increased integrated launched led maintained managed mentored migrated modeled optimized orchestrated organized pioneered presented programmed " +
  "prototyped published redesigned reduced refactored researched resolved scaled shipped simplified solved spearheaded streamlined tested trained " +
  "transformed won wrote curated benchmarked containerized coordinated delivered identified initiated owned piloted secured validated visualized").split(" ");
const VERB_SET = new Set(ACTION_VERBS);
const WEAK_PHRASES = ["responsible for", "worked on", "helped with", "helped to", "involved in", "duties included", "tasked with", "assisted in", "participated in"];
const CLICHES = ["hardworking", "hard-working", "team player", "go-getter", "self-motivated", "detail-oriented", "think outside the box", "synergy", "dynamic individual", "quick learner", "passionate about"];
const PERSONAL = /\b(date of birth|d\.?o\.?b\.?|marital status|father'?s name|mother'?s name|religion|caste|nationality|gender|passport no|aadhaar|aadhar|pan card|blood group)\b/i;
const PRONOUNS = /\b(I|me|my|myself)\b/;

const SECTION_RE: Record<string, RegExp> = {
  summary: /^(professional\s+)?(summary|profile|objective|career objective|about me)\b/i,
  education: /^(education|academic|academics|qualifications?|educational background)\b/i,
  experience: /^((work|professional)\s+)?(experience|employment|internships?|work history)\b/i,
  projects: /^(academic\s+|personal\s+|key\s+)?projects?\b/i,
  skills: /^((technical|key|core)\s+)?(skills|technologies|tech stack|competencies|tools)\b/i,
  achievements: /^(achievements?|awards?|honou?rs|accomplishments|certifications?|publications?|hackathons?)\b/i
};

function findSections(lines: string[]) {
  const found: Record<string, number> = {};
  lines.forEach((l, i) => {
    const t = l.replace(/[:|•\-–_]+$/g, "").trim();
    if (t.length > 40) return;
    for (const [k, re] of Object.entries(SECTION_RE)) if (!(k in found) && re.test(t)) found[k] = i;
  });
  return found;
}

function bulletsOf(lines: string[], sections: Record<string, number>): string[] {
  const marked = lines.filter((l) => /^\s*([•●▪◦‣\-*–]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^\s*([•●▪◦‣\-*–]|\d+[.)])\s+/, "").trim());
  if (marked.length >= 3) return marked.filter((b) => b.length > 15);
  // no bullet glyphs (common after PDF extraction): take sentence-like lines from experience/projects sections
  const starts = [sections.experience, sections.projects].filter((x) => x !== undefined) as number[];
  const ends = Object.values(sections).sort((a, b) => a - b);
  const out: string[] = [];
  for (const s of starts) {
    const e = ends.find((x) => x > s) ?? lines.length;
    for (const l of lines.slice(s + 1, e)) if (l.split(/\s+/).length >= 6) out.push(l.trim());
  }
  return out;
}

const firstWord = (b: string) => (b.toLowerCase().match(/^[a-z-]+/)?.[0] ?? "");
const isActionLed = (b: string) => { const w = firstWord(b); return VERB_SET.has(w) || (/ed$/.test(w) && w.length > 4); };
const isQuantified = (b: string) => /(\d+(\.\d+)?\s*(%|x|k|\+|ms|s\b|hrs?|users|students|people|members|projects|apis|models|requests|accuracy|times))|(\b\d{2,}\b)|₹|\$|\b\d+(\.\d+)?%/i.test(b);

export function runAtsChecks(resumeText: string, jd?: string): AtsReport {
  const text = (resumeText || "").replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  const wc = words.length;
  const lower = text.toLowerCase();
  const sections = findSections(lines);
  const bullets = bulletsOf(lines, sections);
  const actionLed = bullets.filter(isActionLed);
  const quantified = bullets.filter(isQuantified);
  const longBullets = bullets.filter((b) => b.split(/\s+/).length > 35);
  const weakUsed = WEAK_PHRASES.filter((p) => lower.includes(p));
  const clichesUsed = CLICHES.filter((p) => lower.includes(p));
  const verbCounts = new Map<string, number>();
  actionLed.forEach((b) => verbCounts.set(firstWord(b), (verbCounts.get(firstWord(b)) || 0) + 1));
  const overused = [...verbCounts.entries()].filter(([, c]) => c >= 4).map(([v]) => v);
  const skills = extractSkills(text);
  const nonAscii = (text.match(/[^\x00-\x7F₹–—’‘“”•●▪◦·é]/g) || []).length;
  const pipes = (text.match(/\|/g) || []).length;
  const tabsOrGaps = lines.filter((l) => / {6,}|\t/.test(l)).length;
  const dateHits = text.match(/\b((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|(19|20)\d{2}\s*(-|–|to)\s*((19|20)\d{2}|present|current|now))/gi) || [];
  const formats = new Set(dateHits.map((d) => (/^\d{1,2}\//.test(d) ? "num" : /^[a-z]/i.test(d) ? "month" : "year")));
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  const C: AtsCheck[] = [];
  const add = (c: AtsCheck) => C.push(c);

  // contact
  add({ id: "email", category: "contact", label: "Email address", weight: 5, pass: /[\w.+-]+@[\w-]+\.[\w.]+/.test(text),
    detail: "", tip: "Add a professional email at the top." });
  add({ id: "phone", category: "contact", label: "Phone number", weight: 4, pass: /(\+?\d[\d\s-]{8,}\d)/.test(text),
    detail: "", tip: "Add a phone number with country code, e.g. +91 98xxxxxx10." });
  add({ id: "linkedin", category: "contact", label: "LinkedIn URL", weight: 3, pass: /linkedin\.com\/in\//i.test(text),
    detail: "", tip: "Add your linkedin.com/in/ URL as plain text (icons alone are not read by ATS)." });
  add({ id: "portfolio", category: "contact", label: "GitHub or portfolio link", weight: 3, pass: /(github\.com\/|gitlab\.com\/|https?:\/\/(?!.*linkedin)[\w.-]+\.(dev|io|me|app|com|in)\b)/i.test(text),
    detail: "", tip: "Add a GitHub or portfolio link so reviewers can see your work." });
  add({ id: "location", category: "contact", label: "Location (city)", weight: 2,
    pass: /\b(hyderabad|bengaluru|bangalore|chennai|mumbai|pune|delhi|noida|gurugram|gurgaon|kolkata|ahmedabad|kochi|india|remote|[A-Z][a-z]+,\s*[A-Z]{2})\b/i.test(lines.slice(0, 8).join(" ")),
    detail: "", tip: "Put your city near your name; many recruiters filter by location." });

  // sections
  const sec = (id: string, label: string, w: number, tip: string) =>
    add({ id: `section_${id}`, category: "sections", label, weight: w, pass: id in sections, detail: id in sections ? "Found" : "Not found", tip });
  sec("education", "Education section", 5, "Add an 'Education' heading with degree, college, years and CGPA.");
  sec("experience", "Experience / Internship section", 4, "Add an 'Experience' or 'Internships' heading. Freshers can list internships, research or freelance work.");
  sec("projects", "Projects section", 4, "Add a 'Projects' heading with 2–4 projects, tech used and outcomes.");
  sec("skills", "Skills section", 5, "Add a 'Skills' heading listing languages, frameworks and tools as plain text.");
  sec("summary", "Summary / objective", 2, "Add a 2-line summary naming the role you want and your strongest skills.");
  add({ id: "skills_count", category: "sections", label: "At least 8 recognisable skills", weight: 3, pass: skills.length >= 8,
    detail: `${skills.length} found: ${skills.slice(0, 12).join(", ")}`, tip: "List concrete tools (e.g. Python, React, PostgreSQL, Docker), not soft skills only." });

  // content
  add({ id: "bullets", category: "content", label: "Uses bullet points", weight: 3, pass: bullets.length >= 5,
    detail: `${bullets.length} bullets`, tip: "Describe each role/project in 2–4 bullets rather than paragraphs." });
  add({ id: "action_verbs", category: "content", label: "Bullets start with action verbs", weight: 6, pass: bullets.length > 0 && pct(actionLed.length, bullets.length) >= 60,
    detail: `${pct(actionLed.length, bullets.length)}% of bullets`, tip: "Start bullets with verbs like Built, Designed, Reduced, Deployed." });
  add({ id: "quantified", category: "content", label: "Bullets show measurable results", weight: 7, pass: bullets.length > 0 && pct(quantified.length, bullets.length) >= 40,
    detail: `${pct(quantified.length, bullets.length)}% of bullets have a number`, tip: "Add real numbers: users, accuracy, latency, % improvement, dataset size. Only use numbers you can defend." });
  add({ id: "weak_phrases", category: "content", label: "No weak phrases", weight: 3, pass: weakUsed.length === 0,
    detail: weakUsed.join(", ") || "None", tip: "Replace 'responsible for / worked on / helped' with what you actually did." });
  add({ id: "pronouns", category: "content", label: "No first-person pronouns", weight: 2, pass: !bullets.some((b) => PRONOUNS.test(b)),
    detail: "", tip: "Drop 'I', 'my', 'me' from bullets; write 'Built X' not 'I built X'." });
  add({ id: "cliches", category: "content", label: "No buzzword clichés", weight: 2, pass: clichesUsed.length === 0,
    detail: clichesUsed.join(", ") || "None", tip: "Show qualities through results instead of words like 'hardworking' or 'team player'." });
  add({ id: "bullet_length", category: "content", label: "Bullets are concise (≤ 35 words)", weight: 2, pass: longBullets.length === 0,
    detail: `${longBullets.length} long bullets`, tip: "Split long bullets; one idea and one result per line." });
  add({ id: "verb_variety", category: "content", label: "Varied action verbs", weight: 1, pass: overused.length === 0,
    detail: overused.join(", ") || "Good variety", tip: "Avoid starting 4+ bullets with the same verb." });
  add({ id: "dates", category: "content", label: "Dates on education and roles", weight: 3, pass: dateHits.length >= 2,
    detail: `${dateHits.length} dates found`, tip: "Add start–end dates (e.g. Jun 2025 – Aug 2025) to each role and degree." });
  add({ id: "date_format", category: "format", label: "Consistent date format", weight: 1, pass: formats.size <= 1 || (formats.size === 2 && formats.has("year")),
    detail: [...formats].join(", ") || "n/a", tip: "Use one date style throughout, e.g. 'Jun 2025'." });

  // format
  add({ id: "length", category: "format", label: "Length fits 1 page (fresher)", weight: 4, pass: wc >= 250 && wc <= 800,
    detail: `${wc} words`, tip: wc < 250 ? "Too thin: add projects, skills and outcomes." : "Trim to one page (~450–700 words) for fresher roles." });
  add({ id: "parseable", category: "format", label: "Text is machine-readable", weight: 5, pass: wc >= 120,
    detail: wc < 120 ? "Very little text was extracted" : "OK", tip: "Export from Word/Docs as a text PDF; scanned or image resumes are unreadable to ATS." });
  add({ id: "columns", category: "format", label: "No tables / multi-column layout", weight: 3, pass: pipes <= 8 && tabsOrGaps <= 4,
    detail: `${pipes} pipes, ${tabsOrGaps} gapped lines`, tip: "Use a single-column layout; tables and side columns get scrambled by ATS parsers." });
  add({ id: "special_chars", category: "format", label: "No icons / emoji / odd symbols", weight: 2, pass: nonAscii <= 5,
    detail: `${nonAscii} unusual characters`, tip: "Replace icons (📞 ✉ ★) with plain words like 'Phone:' and 'Email:'." });
  add({ id: "personal_info", category: "format", label: "No unnecessary personal details", weight: 2, pass: !PERSONAL.test(text),
    detail: (text.match(PERSONAL) || [""])[0], tip: "Remove DOB, marital status, father's name, religion, ID numbers. Not needed and a bias risk." });

  // JD-dependent
  let keywords: AtsReport["keywords"];
  if (jd && jd.trim().length > 50) {
    const gap = skillGap(text, jd);
    const terms = topTerms(jd, 20).filter((t) => !gap.required.some((s) => s.toLowerCase() === t));
    const termHits = terms.filter((t) => new RegExp(`\\b${escapeRegExp(t)}`, "i").test(text));
    const coverage = gap.required.length ? pct(gap.matched.length, gap.required.length) : pct(termHits.length, terms.length);
    keywords = { matched: [...gap.matched, ...termHits], missing: [...gap.missing, ...terms.filter((t) => !termHits.includes(t)).slice(0, 8)], coverage };
    add({ id: "jd_skills", category: "keywords", label: "Covers the JD's hard skills (≥ 60%)", weight: 10, pass: coverage >= 60,
      detail: `${coverage}% · missing: ${gap.missing.slice(0, 10).join(", ") || "none"}`, tip: "Add the missing skills you genuinely have to Skills and to a relevant bullet. Don't add ones you don't." });
    add({ id: "jd_terms", category: "keywords", label: "Uses the JD's language", weight: 4, pass: terms.length === 0 || pct(termHits.length, terms.length) >= 40,
      detail: `${termHits.length}/${terms.length} frequent JD terms`, tip: "Mirror the JD's wording where it is true (e.g. 'REST APIs' vs 'web services')." });
    const jdTitle = (jd.split("\n").find((l) => l.trim().length > 3) || "").toLowerCase();
    const titleWords = jdTitle.match(/\b(engineer|developer|analyst|scientist|intern|designer|associate|consultant|ml|ai|data|software|backend|frontend|full ?stack)\b/g) || [];
    add({ id: "jd_title", category: "keywords", label: "Resume mentions the target role", weight: 3,
      pass: titleWords.length === 0 || titleWords.some((w) => lower.includes(w.replace(" ", ""))) ,
      detail: titleWords.join(" ") || "n/a", tip: "Put the target title in your summary/headline, e.g. 'Aspiring ML Engineer'." });
  }

  const total = C.reduce((a, c) => a + c.weight, 0);
  const got = C.filter((c) => c.pass).reduce((a, c) => a + c.weight, 0);
  const score = Math.round((got / total) * 100);
  const weak = bullets.filter((b) => !isActionLed(b) || !isQuantified(b) || WEAK_PHRASES.some((p) => b.toLowerCase().includes(p))).slice(0, 8);
  return {
    score, grade: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "needs work" : "poor",
    checks: C, keywords, weak_bullets: weak,
    stats: { words: wc, bullets: bullets.length, action_led: actionLed.length, quantified: quantified.length, skills: skills.length, checks: C.length, passed: C.filter((c) => c.pass).length }
  };
}

/** Plain-text version of a parsed profile, used when only profile_json is available. */
export function profileToText(p: any): string {
  if (!p) return "";
  const L: string[] = [p.full_name, [p.email, p.phone, p.location].filter(Boolean).join(" | "), [p.linkedin, p.github, p.portfolio].filter(Boolean).join(" | "), ""];
  if (p.summary) L.push("Summary", p.summary, "");
  if (p.education?.length) { L.push("Education"); p.education.forEach((e: any) => L.push(`${e.degree} ${e.field}, ${e.institution} ${e.start}–${e.end} ${e.grade}`)); L.push(""); }
  if (p.experience?.length) { L.push("Experience"); p.experience.forEach((e: any) => { L.push(`${e.title}, ${e.company} ${e.start}–${e.end}`); (e.bullets || []).forEach((b: string) => L.push(`• ${b}`)); }); L.push(""); }
  if (p.projects?.length) { L.push("Projects"); p.projects.forEach((e: any) => { L.push(`${e.name} (${(e.tech || []).join(", ")})`); (e.bullets || []).forEach((b: string) => L.push(`• ${b}`)); }); L.push(""); }
  if (p.skills?.length) L.push("Skills", p.skills.join(", "), "");
  if (p.achievements?.length || p.certifications?.length) { L.push("Achievements"); [...(p.achievements || []), ...(p.certifications || [])].forEach((a: string) => L.push(`• ${a}`)); }
  return L.filter((x) => x !== undefined).join("\n");
}

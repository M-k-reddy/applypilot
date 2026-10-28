import { fetchWithTimeout, htmlToText, pool } from "../text";
import { CompanySeed, Job, MAX_DESC, iso } from "./types";

const SENIOR_LEVELS = new Set(["mid_senior_level", "director", "executive"]);

// https://api.smartrecruiters.com/v1/companies/{id}/postings  (public, no key)
// The list has no description, so we fetch details only for entry-level/unspecified postings (capped).
export async function fetchSmartRecruiters(c: CompanySeed, opts: { country?: string; maxDetails?: number } = {}): Promise<Job[]> {
  const out: any[] = [];
  for (let offset = 0; offset < 400; offset += 100) {
    const qs = new URLSearchParams({ limit: "100", offset: String(offset), ...(opts.country ? { country: opts.country } : {}) });
    const r = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.token)}/postings?${qs}`, {}, 20000);
    if (!r.ok) throw new Error(`smartrecruiters ${c.token} ${r.status}`);
    const page = await r.json();
    out.push(...(page.content || []));
    if (out.length >= (page.totalFound || 0) || !(page.content || []).length) break;
  }
  const keep = out.filter((j) => !SENIOR_LEVELS.has(j.experienceLevel?.id));
  const detailed = await pool(keep.slice(0, opts.maxDetails ?? 25), 5, async (j) => {
    try {
      const r = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.token)}/postings/${j.id}`, {}, 10000);
      if (!r.ok) return "";
      const d = await r.json();
      const s = d.jobAd?.sections || {};
      return htmlToText([s.companyDescription?.text, s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text].filter(Boolean).join("\n"));
    } catch { return ""; }
  });
  return keep.map((j: any, i: number): Job => {
    const L = j.location || {};
    const level = j.experienceLevel?.label || "";
    return {
      source: "smartrecruiters", external_id: `smartrecruiters:${c.token}:${j.id}`,
      title: j.name || "", company: c.name,
      location: L.fullLocation || [L.city, L.region, L.country].filter(Boolean).join(", "),
      remote: !!L.remote, apply_url: `https://jobs.smartrecruiters.com/${c.token}/${j.id}`,
      description: ((detailed[i] || "") + (level ? `\nExperience level: ${level}` : "")).slice(0, MAX_DESC),
      posted_at: iso(j.releasedDate), department: j.function?.label || j.department?.label, employment_type: j.typeOfEmployment?.label,
      fresher: ["entry_level", "internship"].includes(j.experienceLevel?.id) || undefined
    };
  });
}

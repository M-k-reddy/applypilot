import { fetchWithTimeout, htmlToText } from "../text";
import { CompanySeed, Job, MAX_DESC, iso } from "./types";

// https://apply.workable.com/api/v1/widget/accounts/{name}?details=true  (public widget API, no key)
// Note: Workable rate-limits aggressively (HTTP 429). Keep the Workable seed list short.
export async function fetchWorkable(c: CompanySeed): Promise<Job[]> {
  const r = await fetchWithTimeout(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(c.token)}?details=true`, {}, 20000);
  if (!r.ok) throw new Error(`workable ${c.token} ${r.status}`);
  const data = await r.json();
  return (data.jobs || []).map((j: any): Job => {
    const loc = j.locations?.[0] || {};
    const location = [j.city || loc.city, j.state || loc.region, j.country || loc.country].filter(Boolean).join(", ");
    return {
      source: "workable", external_id: `workable:${c.token}:${j.shortcode || j.id}`,
      title: j.title || "", company: data.name || c.name, location,
      remote: !!j.telecommuting || /remote/i.test(location),
      apply_url: j.url || j.shortlink || `https://apply.workable.com/${c.token}/j/${j.shortcode}/`,
      description: htmlToText(j.description || "").slice(0, MAX_DESC),
      posted_at: iso(j.published_on || j.created_at), department: j.department, employment_type: j.employment_type
    };
  });
}

import { fetchWithTimeout, htmlToText } from "../text";
import { CompanySeed, Job, MAX_DESC, iso } from "./types";

// https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true  (public, no key)
export async function fetchGreenhouse(c: CompanySeed): Promise<Job[]> {
  const r = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.token)}/jobs?content=true`, {}, 20000);
  if (!r.ok) throw new Error(`greenhouse ${c.token} ${r.status}`);
  const { jobs = [] } = await r.json();
  return jobs.map((j: any): Job => {
    const location = j.location?.name || (j.offices || []).map((o: any) => o.location || o.name).filter(Boolean).join("; ") || "";
    return {
      source: "greenhouse", external_id: `greenhouse:${c.token}:${j.id}`,
      title: j.title || "", company: c.name || j.company_name, location,
      remote: /remote/i.test(location), apply_url: j.absolute_url,
      description: htmlToText(j.content || "").slice(0, MAX_DESC),
      posted_at: iso(j.first_published || j.updated_at), department: j.departments?.[0]?.name
    };
  });
}

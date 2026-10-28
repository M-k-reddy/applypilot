import { fetchWithTimeout } from "../text";
import { Job, MAX_DESC, iso } from "./types";

/** Optional: JSearch (RapidAPI). Only used when RAPIDAPI_KEY is set. */
export const jsearchEnabled = () => !!process.env.RAPIDAPI_KEY;

export async function fetchJSearch(q: string, location = "India", opts: { remote?: boolean; fresher?: boolean } = {}): Promise<Job[]> {
  if (!jsearchEnabled()) return [];
  const params = new URLSearchParams({
    query: `${q} in ${location}`, page: "1", num_pages: "1", country: "in", date_posted: "week",
    ...(opts.remote ? { work_from_home: "true" } : {}),
    ...(opts.fresher !== false ? { job_requirements: "no_experience,under_3_years_experience" } : {})
  });
  const r = await fetchWithTimeout(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" }
  }, 20000);
  if (!r.ok) throw new Error(`jsearch ${r.status}`);
  const { data = [] } = await r.json();
  return data.map((j: any): Job => ({
    source: "jsearch", external_id: `jsearch:${j.job_id}`, title: j.job_title, company: j.employer_name,
    location: [j.job_city, j.job_state].filter(Boolean).join(", ") || j.job_country || "",
    remote: !!j.job_is_remote, apply_url: j.job_apply_link, description: (j.job_description || "").slice(0, MAX_DESC),
    posted_at: iso(j.job_posted_at_datetime_utc)
  }));
}

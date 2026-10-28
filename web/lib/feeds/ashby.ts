import { fetchWithTimeout, htmlToText } from "../text";
import { CompanySeed, Job, MAX_DESC, iso } from "./types";

// https://api.ashbyhq.com/posting-api/job-board/{name}  (public, no key)
export async function fetchAshby(c: CompanySeed): Promise<Job[]> {
  const r = await fetchWithTimeout(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.token)}`, {}, 20000);
  if (!r.ok) throw new Error(`ashby ${c.token} ${r.status}`);
  const { jobs = [] } = await r.json();
  return jobs.filter((j: any) => j.isListed !== false).map((j: any): Job => {
    const locs = [j.location, ...(j.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean);
    const country = j.address?.postalAddress?.addressCountry;
    return {
      source: "ashby", external_id: `ashby:${c.token}:${j.id}`,
      title: j.title || "", company: c.name, location: [locs.join("; "), country].filter(Boolean).join(", "),
      // Ashby sets isRemote=true for Hybrid roles too, so trust workplaceType when present
      remote: j.workplaceType ? j.workplaceType === "Remote" : !!j.isRemote, apply_url: j.jobUrl || j.applyUrl,
      description: (j.descriptionPlain || htmlToText(j.descriptionHtml || "")).slice(0, MAX_DESC),
      posted_at: iso(j.publishedAt), department: j.department || j.team, employment_type: j.employmentType
    };
  });
}

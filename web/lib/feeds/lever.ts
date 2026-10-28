import { fetchWithTimeout, htmlToText } from "../text";
import { CompanySeed, Job, MAX_DESC, iso } from "./types";

// https://api.lever.co/v0/postings/{company}?mode=json  (public, no key)
export async function fetchLever(c: CompanySeed): Promise<Job[]> {
  const r = await fetchWithTimeout(`https://api.lever.co/v0/postings/${encodeURIComponent(c.token)}?mode=json`, {}, 20000);
  if (!r.ok) throw new Error(`lever ${c.token} ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) return [];
  return list.map((j: any): Job => {
    const cat = j.categories || {};
    const location = (cat.allLocations?.length ? cat.allLocations.join("; ") : cat.location) || "";
    const lists = (j.lists || []).map((l: any) => `${l.text}\n${htmlToText(l.content || "")}`).join("\n");
    const description = [j.descriptionPlain || htmlToText(j.description || ""), lists, j.additionalPlain || ""].filter(Boolean).join("\n");
    return {
      source: "lever", external_id: `lever:${c.token}:${j.id}`,
      title: j.text || "", company: c.name, location: [location, j.country].filter(Boolean).join(", "),
      remote: j.workplaceType === "remote" || /remote/i.test(location), apply_url: j.hostedUrl || j.applyUrl,
      description: description.slice(0, MAX_DESC), posted_at: iso(j.createdAt),
      department: cat.department || cat.team, employment_type: cat.commitment
    };
  });
}

import { fitsExperience, parseExperience } from "../experience";
import { extractSkills } from "../skills";
import { norm } from "../text";
import { Job } from "./types";

export type FeedFilter = {
  keywords?: string | string[];  // "ml intern, data analyst" – any one may match
  location?: string;             // "Hyderabad, Bengaluru, Remote" – any one may match; "India" matches Indian cities
  remote?: boolean;              // only remote jobs
  fresher?: boolean;             // default true: drop jobs needing more than maxYears
  maxYears?: number;             // default 2 (so "3+ years" is rejected)
};

const INDIA = ["india", "hyderabad", "secunderabad", "bengaluru", "bangalore", "chennai", "mumbai", "pune", "delhi", "new delhi", "gurugram",
  "gurgaon", "noida", "kolkata", "ahmedabad", "kochi", "trivandrum", "thiruvananthapuram", "coimbatore", "jaipur", "indore", "chandigarh",
  "mysore", "mysuru", "visakhapatnam", "vizag", "bhubaneswar", "nagpur", "vijayawada", "warangal", "mangalore", "mangaluru"];
const IN_CODE = /(^|[\s,(;])IN($|[\s,);])/;   // Lever appends the ISO country code
const OPEN_REGION = /\b(india|apac|asia|global|anywhere|worldwide|international)\b/i;

/**
 * Remote and workable from India: the location is just "Remote", or names India/APAC/Global/Anywhere.
 * "Remote - USA" or "Remote, Malaysia" are excluded because most such roles need local work authorization.
 */
export const remoteFromIndia = (j: Job) => {
  if (!j.remote) return false;
  const loc = j.location || "";
  if (OPEN_REGION.test(loc) || IN_CODE.test(loc)) return true;
  return norm(loc).replace(/\b(remote|hybrid|home|work from|wfh|first|only)\b/g, "").trim() === "";
};
const inIndia = (j: Job) => IN_CODE.test(j.location || "") || INDIA.some((c) => ` ${norm(j.location)} `.includes(` ${c} `));

const list = (v?: string | string[]) => (Array.isArray(v) ? v : (v || "").split(/[,;\n]/)).map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Attach experience info parsed from the title/description. */
export function enrich(j: Job): Job {
  const e = parseExperience(j.title, j.description);
  return { ...j, experience_min: e.min, experience_max: e.max, fresher: !!(j.fresher || e.fresher), skills: extractSkills(`${j.title}\n${j.description}`) };
}

export function matchesKeywords(j: Job, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const title = ` ${norm(`${j.title} ${j.department || ""}`)} `;
  const desc = ` ${norm(j.description).slice(0, 4000)} `;
  return keywords.some((k) => {
    const words = norm(k).split(" ").filter(Boolean);
    if (!words.length) return false;
    if (words.every((w) => title.includes(` ${w}`))) return true;
    return words.length > 1 && desc.includes(` ${words.join(" ")} `) && words.some((w) => title.includes(` ${w}`));
  });
}

export function matchesLocation(j: Job, locations: string[]): boolean {
  if (!locations.length) return true;
  const loc = ` ${norm(j.location)} `;
  return locations.some((l) => {
    if (l === "remote") return remoteFromIndia(j);
    if (l === "india") return inIndia(j) || (j.remote && /india|apac|asia/i.test(j.location));
    return loc.includes(` ${norm(l)}`);
  });
}

export function filterJobs(jobs: Job[], f: FeedFilter): Job[] {
  const kws = list(f.keywords), locs = list(f.location);
  const fresher = f.fresher !== false, maxYears = f.maxYears ?? 2;
  return jobs.filter((j) => {
    if (f.remote && !remoteFromIndia(j)) return false;
    if (!matchesLocation(j, locs)) return false;
    if (!matchesKeywords(j, kws)) return false;
    if (fresher) {
      // rows from the DB carry precomputed experience fields and may omit the description
      const fromTitle = parseExperience(j.title, j.description || "");
      const e = j.experience_min !== undefined && !j.description
        ? { ...fromTitle, min: j.experience_min ?? null, max: j.experience_max ?? null }
        : fromTitle;
      if (!fitsExperience({ ...e, fresher: e.fresher || !!j.fresher }, maxYears)) return false;
    }
    return true;
  });
}

/** Same company + title + location (or the same apply URL) counts once; keeps the newest. */
export function dedupeJobs(jobs: Job[]): Job[] {
  const seen = new Map<string, Job>(); const urls = new Set<string>();
  const sorted = [...jobs].sort((a, b) => (b.posted_at || "").localeCompare(a.posted_at || ""));
  for (const j of sorted) {
    const key = `${norm(j.company)}|${norm(j.title)}|${norm(j.location).split(" ").slice(0, 3).join(" ")}`;
    const url = (j.apply_url || "").split("?")[0];
    if (seen.has(key) || (url && urls.has(url))) continue;
    seen.set(key, j); if (url) urls.add(url);
  }
  return [...seen.values()];
}

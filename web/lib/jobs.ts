// Free job sources, normalised into one shape and de-duplicated.
// Adzuna (free key, India) when ADZUNA_APP_ID/ADZUNA_APP_KEY are set; Remotive + Arbeitnow (public, no key);
// JSearch (RapidAPI) only if RAPIDAPI_KEY is set.

export type JobListing = {
  external_id: string; source: "adzuna" | "remotive" | "arbeitnow" | "jsearch" | "extension";
  title: string; company: string; location: string; remote: boolean;
  apply_url: string; description: string; posted_at: string | null; salary: string;
  fresher: boolean;
};

export type JobQuery = { q: string; location: string; remote: boolean; fresher: boolean };

const strip = (html: string) => (html || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
  .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

const SENIOR = /\b(senior|sr\.?|lead|principal|staff|manager|head of|director|architect|vp|chief)\b/i;
const JUNIOR = /\b(intern(ship)?|fresher|graduate|entry[- ]level|junior|jr\.?|trainee|apprentice|campus|0[- ]?[-–to]+ ?[12] years?)\b/i;

/** Heuristic: is this suitable for a fresher / student? */
export function isFresherFriendly(title: string, description: string): boolean {
  if (SENIOR.test(title)) return false;
  if (JUNIOR.test(title) || JUNIOR.test(description.slice(0, 1500))) return true;
  const yrs = [...description.matchAll(/(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*\d*\s*\+?\s*years?/gi)].map((m) => Number(m[1]));
  return !yrs.length || Math.min(...yrs) <= 2;
}

const looksRemote = (s: string) => /\b(remote|work from home|wfh|anywhere)\b/i.test(s);

function mk(j: Omit<JobListing, "fresher" | "description"> & { description: string }): JobListing {
  const description = strip(j.description).slice(0, 8000);
  return { ...j, title: j.title.trim().slice(0, 200), company: (j.company || "Unknown").trim().slice(0, 160), description, fresher: isFresherFriendly(j.title, description) };
}

async function getJSON(url: string, init: RequestInit = {}, ms = 8000): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, next: { revalidate: 900 } } as RequestInit);
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function adzuna(q: JobQuery): Promise<JobListing[]> {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const p = new URLSearchParams({ app_id: id, app_key: key, results_per_page: "30", what: q.q, "content-type": "application/json", sort_by: "date", max_days_old: "30" });
  if (q.location && !/^(india|anywhere)$/i.test(q.location)) p.set("where", q.location);
  const j = await getJSON(`https://api.adzuna.com/v1/api/jobs/in/search/1?${p}`);
  return (j.results || []).map((r: any) => mk({
    external_id: `adzuna:${r.id}`, source: "adzuna", title: r.title || "", company: r.company?.display_name || "",
    location: r.location?.display_name || "India", remote: looksRemote(`${r.title} ${r.description}`),
    apply_url: r.redirect_url || "", description: r.description || "", posted_at: r.created || null,
    salary: r.salary_min ? `₹${Math.round(r.salary_min).toLocaleString("en-IN")}${r.salary_max && r.salary_max !== r.salary_min ? "–" + Math.round(r.salary_max).toLocaleString("en-IN") : ""}/yr` : ""
  }));
}

async function remotive(q: JobQuery): Promise<JobListing[]> {
  const j = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q.q)}&limit=40`);
  return (j.jobs || []).map((r: any) => mk({
    external_id: `remotive:${r.id}`, source: "remotive", title: r.title || "", company: r.company_name || "",
    location: r.candidate_required_location || "Remote", remote: true, apply_url: r.url || "",
    description: r.description || "", posted_at: r.publication_date || null, salary: r.salary || ""
  }));
}

async function arbeitnow(q: JobQuery): Promise<JobListing[]> {
  const j = await getJSON("https://www.arbeitnow.com/api/job-board-api");
  const words = q.q.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["fresher", "freshers", "intern", "jobs", "job"].includes(w));
  return (j.data || [])
    .filter((r: any) => { const t = `${r.title} ${(r.tags || []).join(" ")}`.toLowerCase(); return !words.length || words.some((w) => t.includes(w)); })
    .map((r: any) => mk({
      external_id: `arbeitnow:${r.slug}`, source: "arbeitnow", title: r.title || "", company: r.company_name || "",
      location: r.location || "", remote: !!r.remote, apply_url: r.url || "", description: r.description || "",
      posted_at: r.created_at ? new Date(r.created_at * 1000).toISOString() : null, salary: ""
    }));
}

async function jsearch(q: JobQuery): Promise<JobListing[]> {
  if (!process.env.RAPIDAPI_KEY) return [];
  const p = new URLSearchParams({ query: `${q.q} in ${q.location || "India"}`, page: "1", num_pages: "1", country: "in", date_posted: "month",
    ...(q.remote ? { work_from_home: "true" } : {}), ...(q.fresher ? { job_requirements: "no_experience,under_3_years_experience" } : {}) });
  const j = await getJSON(`https://jsearch.p.rapidapi.com/search?${p}`, { headers: { "X-RapidAPI-Key": process.env.RAPIDAPI_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } });
  return (j.data || []).map((r: any) => mk({
    external_id: `jsearch:${r.job_id}`, source: "jsearch", title: r.job_title || "", company: r.employer_name || "",
    location: [r.job_city, r.job_state].filter(Boolean).join(", ") || r.job_country || "", remote: !!r.job_is_remote,
    apply_url: r.job_apply_link || "", description: r.job_description || "", posted_at: r.job_posted_at_datetime_utc || null, salary: ""
  }));
}

const key = (j: JobListing) => `${j.title}|${j.company}`.toLowerCase().replace(/[^a-z0-9|]/g, "");

export async function searchJobs(q: JobQuery): Promise<{ jobs: JobListing[]; sources: Record<string, string> }> {
  const sources: Record<string, string> = {};
  const tasks: [string, Promise<JobListing[]>][] = [["adzuna", adzuna(q)], ["jsearch", jsearch(q)], ["remotive", remotive(q)], ["arbeitnow", arbeitnow(q)]];
  const settled = await Promise.allSettled(tasks.map((t) => t[1]));
  const all: JobListing[] = [];
  settled.forEach((r, i) => {
    const name = tasks[i][0];
    if (r.status === "fulfilled") { sources[name] = r.value.length ? `${r.value.length} jobs` : (name === "adzuna" && !process.env.ADZUNA_APP_ID) || (name === "jsearch" && !process.env.RAPIDAPI_KEY) ? "not configured" : "0 jobs"; all.push(...r.value); }
    else sources[name] = "unavailable";
  });

  const seen = new Set<string>();
  const loc = q.location.trim().toLowerCase();
  const out = all.filter((j) => {
    if (!j.title || !j.apply_url) return false;
    const k = key(j); if (seen.has(k)) return false; seen.add(k);
    if (q.remote && !j.remote) return false;
    if (q.fresher && !j.fresher) return false;
    if (j.source !== "adzuna" && j.source !== "jsearch") {
      // Global boards: keep only jobs an Indian candidate can take (open to India / worldwide / APAC) or matching the typed city.
      const l = j.location.toLowerCase();
      const openToIndia = /india|worldwide|anywhere|asia|apac|global/.test(l) || (loc && !/^(india|anywhere)$/.test(loc) && l.includes(loc));
      if (!openToIndia || (j.source === "arbeitnow" && !j.remote && !/india/.test(l))) return false;
    }
    return true;
  });
  // India-first ordering: Adzuna/JSearch (India) before global remote boards, newest first within each.
  const rank = (j: JobListing) => (j.source === "adzuna" || j.source === "jsearch" ? 0 : /india/i.test(j.location) ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || (Date.parse(b.posted_at || "") || 0) - (Date.parse(a.posted_at || "") || 0));
  return { jobs: out.slice(0, 60), sources };
}

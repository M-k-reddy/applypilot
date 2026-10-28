import { pool } from "../text";
import { fetchAshby } from "./ashby";
import { loadCompanies } from "./companies";
import { dedupeJobs, enrich, filterJobs, FeedFilter } from "./filter";
import { fetchGreenhouse } from "./greenhouse";
import { fetchJSearch, jsearchEnabled } from "./jsearch";
import { fetchLever } from "./lever";
import { fetchSmartRecruiters } from "./smartrecruiters";
import { CompanySeed, Job } from "./types";
import { fetchWorkable } from "./workable";

export * from "./types";
export { filterJobs, dedupeJobs, enrich } from "./filter";
export type { FeedFilter } from "./filter";

const FETCHERS: Record<CompanySeed["ats"], (c: CompanySeed) => Promise<Job[]>> = {
  greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby, workable: fetchWorkable, smartrecruiters: fetchSmartRecruiters
};

export type FeedRun = { jobs: Job[]; errors: { company: string; error: string }[]; perCompany: Record<string, number> };

/** Fetch every seed board (free public APIs), normalize, enrich with experience info, dedupe. */
export async function fetchAllFeeds(companies: CompanySeed[] = loadCompanies(), concurrency = 6): Promise<FeedRun> {
  const errors: FeedRun["errors"] = []; const perCompany: Record<string, number> = {};
  const lists = await pool(companies, concurrency, async (c) => {
    try { const js = await FETCHERS[c.ats](c); perCompany[c.name] = js.length; return js; }
    catch (e: any) { errors.push({ company: `${c.ats}:${c.token}`, error: String(e?.message || e) }); return []; }
  });
  const jobs = dedupeJobs(lists.flat().filter((j) => j.title && j.apply_url).map(enrich));
  return { jobs, errors, perCompany };
}

/** Live search without the database: fetch, then filter. Adds JSearch results when RAPIDAPI_KEY is set. */
export async function searchLive(f: FeedFilter, companies?: CompanySeed[]): Promise<{ jobs: Job[]; errors: FeedRun["errors"] }> {
  const run = await fetchAllFeeds(companies);
  let jobs = filterJobs(run.jobs, f);
  if (jsearchEnabled()) {
    try {
      const q = (Array.isArray(f.keywords) ? f.keywords.join(" ") : f.keywords) || "software engineer fresher";
      const extra = (await fetchJSearch(q, f.location || "India", { remote: f.remote, fresher: f.fresher })).map(enrich);
      jobs = dedupeJobs([...jobs, ...filterJobs(extra, { ...f, keywords: undefined, location: undefined })]);
    } catch (e: any) { run.errors.push({ company: "jsearch", error: String(e?.message || e) }); }
  }
  return { jobs, errors: run.errors };
}

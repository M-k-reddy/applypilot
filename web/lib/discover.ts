// Hands-free job discovery for the extension's Auto mode.
// Pulls fresh postings straight from public ATS board APIs (Greenhouse, Lever) whose apply URLs are directly
// fillable forms, then the existing aggregator sources as a secondary pool. Entry-level + location filtered,
// de-duplicated, and scored with the deterministic ATS keyword scorer (no LLM per job, so no AI quota is used).
import { searchJobs, isFresherFriendly, type JobListing } from "./jobs";

// Curated seed boards: companies that hire in India and/or remote and post through Greenhouse or Lever.
// Every token below returned HTTP 200 from its public board API on 2026-10-26 (verified with curl).
export const GREENHOUSE_BOARDS = [
  "agoda", "airbnb", "appian", "celonis", "coinbase", "databricks", "datadog", "druva", "elastic", "fivetran",
  "gitlab", "grafanalabs", "groww", "hackerrank", "mongodb", "newrelic", "observeai", "okta", "pinterest", "purestorage",
  "razorpaysoftwareprivatelimited", "reddit", "rubrik", "samsara", "slice", "stripe", "sumologic", "twilio", "vercel", "zscaler",
  "affirm", "launchdarkly", "mercury", "mixpanel", "pubmatic", "smartsheet", "circleci", "cockroachlabs", "coursera",
  "inmobi", "commvault", "bitgo", "turing", "intercom"
];
export const LEVER_BOARDS = [
  "cred", "fampay", "fi", "meesho", "paytm", "zeta", "mindtickle", "nium", "binance", "outreach", "pocketfm", "spotify",
  "hevodata", "jumpcloud"
];

/** keywords: user overrides from the Auto tab (a relevance gate); search: free-text query for the aggregator sources. */
export type DiscoverQuery = { keywords: string[]; search: string; location: string; remote: boolean };
export type Discovered = JobListing & { ats_board: string };

const strip = (html: string) => (html || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
  .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

const SENIOR = /\b(senior|sr\.?|lead|principal|staff|manager|head of|director|architect|vp|chief|counsel|ii|iii|iv|2|3)\b/i;
/** Entry-level by title: intern, fresher, graduate, junior, trainee, associate, "Engineer I", "SDE-1", etc. */
const ENTRY_TITLE = /\b(intern(ship)?|fresher|graduate|new grad|entry[- ]level|junior|jr\.?|trainee|apprentice|campus|early career|university|associate|sde[- ]?(1|i)|(engineer|developer|analyst|scientist)[- ,]+(1|i))\b/i;
export const isEntryTitle = (title: string) => ENTRY_TITLE.test(title) && !SENIOR.test(title.replace(/\b(sde|engineer|developer|analyst|scientist)[- ,]+(1|i)\b/gi, ""));

const INDIA = /\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|ncr|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad|kochi|coimbatore|jaipur|indore|chandigarh|trivandrum|thiruvananthapuram|mysore|mysuru|vizag|visakhapatnam)\b/i;
const OPEN_REMOTE = /\b(remote|anywhere|worldwide|global(ly)?|apac|asia)\b/i;
// A remote role tied to another country/region is not open to a candidate in India.
const OTHER_REGION = /\b(us|usa|u\.s\.|united states|americas?|north america|latam|canada|mexico|brazil|uk|united kingdom|ireland|europe|emea|eu|germany|france|spain|poland|netherlands|portugal|italy|sweden|japan|korea|singapore|australia|new zealand|philippines|vietnam|indonesia|china|israel|uae|dubai|south africa|nigeria|kenya|colombia|argentina|chile)\b/i;

/** Does a posting's location suit the candidate? q.location may list several places ("Hyderabad, Bengaluru, Remote"). */
const CITY_ALIAS: [RegExp, string][] = [[/\bbangalore\b/g, "bengaluru"], [/\bgurgaon\b/g, "gurugram"], [/\bbombay\b/g, "mumbai"], [/\bnew delhi\b/g, "delhi"], [/\bmadras\b/g, "chennai"], [/\bcalcutta\b/g, "kolkata"], [/\bmysore\b/g, "mysuru"], [/\bvizag\b/g, "visakhapatnam"], [/\btrivandrum\b/g, "thiruvananthapuram"]];
const canonCity = (s: string) => CITY_ALIAS.reduce((x, [re, to]) => x.replace(re, to), s.toLowerCase());

export function locationOk(jobLoc: string, q: DiscoverQuery): boolean {
  const l = canonCity(jobLoc || "");
  const wants = canonCity(q.location).split(/[,;/|]| or /).map((x) => x.trim()).filter(Boolean);
  const cities = wants.filter((w) => !/^(india|anywhere|remote|any|wfh|work from home|pan india)$/.test(w));
  const remoteOk = q.remote || wants.some((w) => /^(remote|anywhere|wfh|work from home)$/.test(w));
  const isRemote = OPEN_REMOTE.test(l);
  if (cities.some((c) => l.includes(c))) return true;
  if (INDIA.test(l)) return !cities.length || (remoteOk && isRemote) || /\bindia\b/.test(l) && !INDIA.test(l.replace(/\bindia\b/g, ""));
  return remoteOk && isRemote && !OTHER_REGION.test(l.replace(/\b(remote|anywhere)\b/g, ""));
}

/** Keyword relevance gate (only when the user typed keywords in the Auto tab): a keyword in the title, or
 *  mentioned at least twice in the description (a single passing mention is not enough). */
function keywordHit(title: string, keywords: string[], description = ""): boolean {
  if (!keywords.length) return true;
  const n = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9+#.]/g, " ").replace(/\s+/g, " ")} `;
  const t = n(title), d = n(description);
  return keywords.some((k) => {
    const w = n(k);
    if (t.includes(w)) return true;
    let c = 0, i = d.indexOf(w); while (i !== -1 && c < 2) { c++; i = d.indexOf(w, i + 1); }
    return c >= 2;
  });
}

async function getJSON(url: string, ms = 9000): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "ApplyPilot/2.2 (+job discovery)" }, cache: "no-store" });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { status: "fulfilled", value: await fn(items[k]) }; } catch (e) { out[k] = { status: "rejected", reason: e }; } }
  }));
  return out;
}

type GhStub = { token: string; id: number; title: string; location: string; updated_at: string | null; host: string };

/** Greenhouse: list each board without content (light), filter by title + location, then fetch details for the survivors only. */
async function greenhouse(q: DiscoverQuery, maxDetails: number): Promise<{ jobs: Discovered[]; ok: number; failed: number }> {
  const lists = await pool(GREENHOUSE_BOARDS, 12, (token) => getJSON(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`).then((d) => ({ token, d })));
  const stubs: GhStub[] = []; let ok = 0, failed = 0;
  for (const r of lists) {
    if (r.status !== "fulfilled") { failed++; continue; }
    ok++;
    const { token, d } = r.value;
    for (const j of (d.jobs || []) as any[]) {
      const title = String(j.title || "").trim(); const location = String(j.location?.name || "");
      if (!title || !isEntryTitle(title) || !locationOk(location, q)) continue;
      let host = "job-boards.greenhouse.io";
      try { const h = new URL(j.absolute_url).hostname; if (/(^|\.)greenhouse\.io$/.test(h) && /\.eu\./.test(h)) host = "job-boards.eu.greenhouse.io"; } catch { /* custom careers site */ }
      stubs.push({ token, id: j.id, title, location, updated_at: j.updated_at || null, host });
    }
  }
  if (q.keywords.length) stubs.sort((a, b) => Number(keywordHit(b.title, q.keywords)) - Number(keywordHit(a.title, q.keywords)));
  const picked = stubs.slice(0, maxDetails);
  const details = await pool(picked, 8, (s) => getJSON(`https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs/${s.id}`, 7000).then((d) => ({ s, d })));
  const jobs: Discovered[] = [];
  for (const r of details) {
    if (r.status !== "fulfilled") continue;
    const { s, d } = r.value;
    const description = strip(d.content || "").slice(0, 8000);
    const company = String(d.company_name || s.token).trim();
    jobs.push({
      external_id: `greenhouse:${s.token}:${s.id}`, source: "greenhouse", ats_board: s.token,
      title: s.title.slice(0, 200), company: company.slice(0, 160), location: s.location.slice(0, 160),
      remote: /remote/i.test(s.location),
      // The hosted application form itself (works even when the company's careers site wraps Greenhouse in an iframe).
      apply_url: `https://${s.host}/embed/job_app?for=${encodeURIComponent(s.token)}&token=${s.id}`,
      description, posted_at: d.first_published || s.updated_at, salary: "", fresher: true
    });
  }
  return { jobs, ok, failed };
}

/** Lever: postings come with descriptions; the apply URL is the hosted form at {hostedUrl}/apply. */
async function lever(q: DiscoverQuery): Promise<{ jobs: Discovered[]; ok: number; failed: number }> {
  const lists = await pool(LEVER_BOARDS, 8, (co) => getJSON(`https://api.lever.co/v0/postings/${co}?mode=json`).then((d) => ({ co, d })));
  const jobs: Discovered[] = []; let ok = 0, failed = 0;
  for (const r of lists) {
    if (r.status !== "fulfilled") { failed++; continue; }
    ok++;
    const { co, d } = r.value;
    for (const p of (Array.isArray(d) ? d : []) as any[]) {
      const title = String(p.text || "").trim();
      const loc = [...new Set([p.categories?.location, ...(p.categories?.allLocations || [])].filter(Boolean))].join("; ");
      const remote = p.workplaceType === "remote" || /remote/i.test(loc);
      const locForCheck = `${loc}${remote ? " remote" : ""}`;
      if (!title || !isEntryTitle(title) || !locationOk(locForCheck, q) || !p.hostedUrl) continue;
      const description = [p.descriptionPlain, ...(p.lists || []).map((l: any) => `${l.text}\n${strip(l.content || "")}`), p.additionalPlain].filter(Boolean).join("\n").slice(0, 8000);
      jobs.push({
        external_id: `lever:${co}:${p.id}`, source: "lever", ats_board: co,
        title: title.slice(0, 200), company: co.charAt(0).toUpperCase() + co.slice(1), location: loc.slice(0, 160) || (remote ? "Remote" : ""),
        remote, apply_url: p.applyUrl || `${String(p.hostedUrl).replace(/\/$/, "")}/apply`, description,
        posted_at: p.createdAt ? new Date(p.createdAt).toISOString() : null, salary: "", fresher: true
      });
    }
  }
  return { jobs, ok, failed };
}

const ATS_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|myworkdayjobs\.com|recruitee\.com|breezy\.hr|bamboohr\.com)$/i;
const BLOCKED_HOST = /(^|\.)linkedin\.com$/i;

/**
 * Fetch fresh entry-level postings for the candidate. ATS boards first (direct forms), aggregators second.
 * Returns more than needed; the caller dedupes against the tracker, scores and trims.
 */
export async function discoverJobs(q: DiscoverQuery, opts: { maxGreenhouseDetails?: number } = {}) {
  const sources: Record<string, string> = {};
  const firstPlace = q.location.split(/[,;/|]/)[0].trim();
  const aggQuery = { q: q.search || q.keywords.slice(0, 3).join(" ") || "software engineer", location: /^(remote|anywhere|wfh)$/i.test(firstPlace) ? "India" : firstPlace || "India", remote: false, fresher: true };
  const [gh, lv, agg] = await Promise.allSettled([greenhouse(q, opts.maxGreenhouseDetails ?? 40), lever(q), searchJobs(aggQuery)]);
  const primary: Discovered[] = [], secondary: Discovered[] = [];
  if (gh.status === "fulfilled") { primary.push(...gh.value.jobs); sources.greenhouse = `${gh.value.jobs.length} matches from ${gh.value.ok}/${GREENHOUSE_BOARDS.length} boards`; } else sources.greenhouse = "unavailable";
  if (lv.status === "fulfilled") { primary.push(...lv.value.jobs); sources.lever = `${lv.value.jobs.length} matches from ${lv.value.ok}/${LEVER_BOARDS.length} boards`; } else sources.lever = "unavailable";
  if (agg.status === "fulfilled") {
    for (const j of agg.value.jobs) {
      let host = ""; try { host = new URL(j.apply_url).hostname; } catch { continue; }
      if (BLOCKED_HOST.test(host) || !j.fresher || SENIOR.test(j.title) && !isEntryTitle(j.title)) continue;
      if (!isFresherFriendly(j.title, j.description)) continue;
      secondary.push({ ...j, ats_board: ATS_HOST.test(host) ? host : "" });
    }
    Object.entries(agg.value.sources).forEach(([k, v]) => { sources[k] = v; });
  }
  // Direct ATS forms from aggregators rank with the primary pool; job-board redirect pages go last.
  secondary.sort((a, b) => Number(!!b.ats_board) - Number(!!a.ats_board));
  const kw = (j: Discovered) => keywordHit(j.title, q.keywords, j.description.slice(0, 6000));
  return { primary: primary.filter(kw), secondary: secondary.filter(kw), sources };
}

// Role families: when the user typed no keywords, a discovered title must belong to the same family as the
// candidate's own target role (headline / past titles / skills), so an engineering profile is not queued for
// support or sales roles just because generic keywords overlap.
const FAMILIES: Record<string, RegExp> = {
  software: /\b(software|developer|engineer(ing)?|sde|programmer|full[- ]?stack|front[- ]?end|back[- ]?end|web|mobile|android|ios|devops|cloud|sre|qa|test|automation|platform|security|infrastructure)\b/i,
  data: /\b(data|analyst|analytics|scientist|machine learning|ml|ai|business intelligence|bi|research)\b/i,
  design: /\b(design(er)?|ui|ux|product designer|graphic|visual|video editor|creative)\b/i,
  product: /\b(product|program|project)\b/i,
  marketing: /\b(marketing|content|seo|social media|growth|brand|copy|communications?)\b/i,
  sales: /\b(sales|business development|bd|partnerships?|account)\b/i,
  support: /\b(support|customer|success|service|operations?)\b/i,
  finance: /\b(finance|accounting|accountant|audit|tax|risk|compliance|credit)\b/i,
  hr: /\b(hr|human resources|talent|recruit(er|ment|ing)?|people)\b/i
};
const TECH_SKILL = /\b(python|java|javascript|typescript|react|node|c\+\+|golang|kotlin|sql|django|flask|spring|android|flutter|html|css|aws|docker)\b/i;
const DATA_SKILL = /\b(pandas|numpy|machine learning|deep learning|tableau|power bi|statistics|scikit|tensorflow|pytorch|data analysis)\b/i;

/** Families the candidate is aiming at, from their headline + titles (+ skills as a fallback). Empty = no gate. */
export function targetFamilies(roleText: string, skills: string[]): string[] {
  const fam = Object.entries(FAMILIES).filter(([, re]) => re.test(roleText)).map(([k]) => k);
  const sk = skills.join(" ");
  if (TECH_SKILL.test(sk) && !fam.includes("software")) fam.push("software");
  if (DATA_SKILL.test(sk) && !fam.includes("data")) fam.push("data");
  return fam;
}
export const titleInFamilies = (title: string, fams: string[]) => !fams.length || fams.some((f) => FAMILIES[f].test(title));

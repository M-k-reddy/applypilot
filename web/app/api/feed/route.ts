import { requireUser, handle, adminClient } from "@/lib/supabase";
import { loadProfile, FEED_COLS } from "@/lib/data";
import { filterJobs, Job } from "@/lib/feeds";
import { ingestFeeds } from "@/lib/feeds/ingest";
import { quickMatch } from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 GET /api/feed?q=ml intern, data analyst&location=Hyderabad, Remote&remote=false&fresher=true&maxYears=2&limit=60
 Free job feed from public Greenhouse / Lever / Ashby / Workable / SmartRecruiters boards (refreshed daily by cron).
 Each job comes back with a deterministic match score against the user's resume.
 If the shared table is empty or older than 36h, it refreshes inline first (needs SUPABASE_SERVICE_ROLE_KEY).
*/
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const u = new URL(req.url);
  const q = u.searchParams.get("q") || "";
  const location = u.searchParams.get("location") || "";
  const remote = u.searchParams.get("remote") === "true";
  const fresher = u.searchParams.get("fresher") !== "false";
  const maxYears = Number(u.searchParams.get("maxYears") || 2);
  const limit = Math.min(200, Number(u.searchParams.get("limit") || 60));

  let refreshed: any = null;
  const { data: latest } = await db.from("feed_jobs").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  const stale = !latest || Date.now() - new Date(latest.last_seen_at).getTime() > 36 * 3600_000;
  if ((stale || u.searchParams.get("refresh") === "true") && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    refreshed = await ingestFeeds(adminClient());
  }

  // pull lightweight rows (no description) and filter in TS; prefilter by title words in SQL
  const words = q.split(/[,;]/).map((k) => k.trim().split(/\s+/).sort((a, b) => b.length - a.length)[0]).map((w) => (w || "").replace(/[^a-zA-Z0-9+#]/g, "")).filter((w) => w.length >= 2);
  const rows: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    let query = db.from("feed_jobs").select(FEED_COLS).order("posted_at", { ascending: false, nullsFirst: false }).range(from, from + 999);
    if (remote) query = query.eq("remote", true);
    // one .or() only (keywords take priority); the precise experience/keyword filtering happens in filterJobs below
    if (words.length) query = query.or(words.map((w) => `title.ilike.%${w}%`).join(","));
    else if (fresher) query = query.or(`experience_min.is.null,experience_min.lte.${Math.floor(maxYears)}`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const jobs = filterJobs(rows as unknown as (Job & { id: string })[], { keywords: q, location, remote, fresher, maxYears }) as (Job & { id: string })[];

  const { profile } = await loadProfile(db, user.id);
  const scored = jobs.map((j) => ({ ...j, match: profile ? quickMatch(profile, j) : null }));
  scored.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || (b.posted_at || "").localeCompare(a.posted_at || ""));
  return Response.json({ total: scored.length, jobs: scored.slice(0, limit), refreshed: refreshed ? { fetched: refreshed.fetched, errors: refreshed.sourceErrors.length } : null });
});

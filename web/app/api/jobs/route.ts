import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { searchJobs } from "@/lib/jobs";
import { saveJob, str } from "@/lib/server";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// GET /api/jobs?q=react intern&location=Hyderabad&remote=true&fresher=true  -> live search across free sources
// GET /api/jobs?saved=1                                                        -> this user's saved jobs
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const u = new URL(req.url);
  if (u.searchParams.get("saved")) {
    const { data, error } = await db.from("jobs").select("id, external_id, source, title, company, location, remote, apply_url, salary, posted_at, fit_score, missing_keywords, created_at, cover_letter")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw new HttpError(500, error.message);
    return Response.json({ jobs: data || [] });
  }
  const q = str(u.searchParams.get("q"), 120) || "software engineer";
  const location = str(u.searchParams.get("location"), 80) || "India";
  const result = await searchJobs({ q, location, remote: u.searchParams.get("remote") === "true", fresher: u.searchParams.get("fresher") === "true" });
  return Response.json(result);
});

// POST { job } -> saves a job (from search results or the extension) and, with track=true, adds it to the tracker as "saved".
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ job?: any; track?: boolean }>(req);
  const job = await saveJob(db, user.id, body.job);
  let applicationId: string | null = null;
  if (body.track) {
    const { data, error } = await db.from("applications").upsert({
      user_id: user.id, job_id: job.id, page_key: `job:${job.id}`, page_url: job.apply_url, company: job.company, title: job.title,
      status: "saved", updated_at: new Date().toISOString()
    }, { onConflict: "user_id,page_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (error) throw new HttpError(500, error.message);
    applicationId = data?.id ?? null;
    if (!applicationId) {
      const { data: ex } = await db.from("applications").select("id").eq("user_id", user.id).eq("page_key", `job:${job.id}`).maybeSingle();
      applicationId = ex?.id ?? null;
    }
  }
  return Response.json({ job, applicationId });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";

/** Profile row + latest raw resume text. */
export async function loadProfile(db: SupabaseClient, userId: string) {
  const [{ data: prof }, { data: res }] = await Promise.all([
    db.from("profiles").select("plan, email, profile_json, preferences").eq("id", userId).single(),
    db.from("resumes").select("raw_text").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  return { plan: (prof?.plan as string) || "free", email: prof?.email as string | undefined, profile: prof?.profile_json as any, preferences: prof?.preferences as any, rawText: (res?.raw_text as string) || "" };
}

export const FEED_COLS: string = "id, external_id, source, title, company, location, remote, apply_url, posted_at, department, employment_type, experience_min, experience_max, fresher, skills, first_seen_at";

/** Copy a shared feed job into the user's own jobs table (so match/tailor results attach to it). */
export async function ensureUserJob(db: SupabaseClient, userId: string, feedJobId: string) {
  const { data: f } = await db.from("feed_jobs").select("*").eq("id", feedJobId).single();
  if (!f) throw new HttpError(404, "Feed job not found");
  const { data, error } = await db.from("jobs").upsert({
    user_id: userId, external_id: f.external_id, title: f.title, company: f.company, location: f.location,
    remote: f.remote, apply_url: f.apply_url, description: f.description, feed_job_id: f.id
  }, { onConflict: "user_id,external_id" }).select("*").single();
  if (error) throw new HttpError(500, error.message);
  return data;
}

/** Resolve a job from any of: jobId (user's jobs), feedJobId (shared feed), or inline {title, company, description}. */
export async function resolveJob(db: SupabaseClient, userId: string, body: any): Promise<{ id?: string; title: string; company: string; location?: string; description: string; apply_url?: string }> {
  if (body.jobId) {
    const { data } = await db.from("jobs").select("*").eq("id", body.jobId).eq("user_id", userId).single();
    if (!data) throw new HttpError(404, "Job not found");
    return data;
  }
  if (body.feedJobId) return ensureUserJob(db, userId, body.feedJobId);
  const j = body.job || body;
  const description = String(j.description || j.jd || "").slice(0, 12000);
  if (description.trim().length < 40) throw new HttpError(400, "Paste the job description (or pick a job)");
  return { title: String(j.title || "the role"), company: String(j.company || "the company"), location: j.location, description, apply_url: j.url || j.apply_url };
}

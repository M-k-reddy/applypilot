import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { atsScore } from "@/lib/ats";
import { profileText } from "@/lib/profile";
import { requireProfile, getJob, str } from "@/lib/server";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// POST { jobId } or { description } -> deterministic ATS keyword score. No AI call, no quota.
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ jobId?: string; description?: string; title?: string }>(req);
  const jd = body.jobId ? (await getJob(db, user.id, body.jobId)).description || "" : `${str(body.title, 200)}\n${str(body.description, 12000)}`;
  if (jd.trim().length < 40) throw new HttpError(400, "Not enough job description text to score");
  const profile = await requireProfile(db, user.id);
  return Response.json(atsScore(jd, profileText(profile)));
});

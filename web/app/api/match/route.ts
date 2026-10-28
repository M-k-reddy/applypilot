import { requireUser, handle, HttpError } from "@/lib/supabase";
import { askJSON, aiConfigured } from "@/lib/gemini";
import { loadProfile, resolveJob, FEED_COLS } from "@/lib/data";
import { quickMatch } from "@/lib/match";
import { checkQuota, recordUsage } from "@/lib/limits";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 Two modes:
 1. Quick (free, deterministic, no quota): POST { quick: true, jobIds?: string[], feedJobIds?: string[] }
    -> { scores: { [id]: { score, matched_skills, missing_skills, experience } } }
 2. Full AI report: POST { jobId | feedJobId | job: {title, company, description} }
    -> { score, fit_score, matched_skills, missing_skills, experience, reasons, missing_keywords, tailored_bullets, cover_letter, jobId }
    Score = 60% deterministic (skills + experience) + 40% AI judgement.
*/
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await req.json();
  const { plan, profile } = await loadProfile(db, user.id);
  if (!profile) throw new HttpError(400, "Upload your resume first");

  if (body.quick) {
    const scores: Record<string, ReturnType<typeof quickMatch>> = {};
    if (body.jobIds?.length) {
      const { data } = await db.from("jobs").select("id, title, description").eq("user_id", user.id).in("id", body.jobIds.slice(0, 200));
      (data || []).forEach((j: any) => (scores[j.id] = quickMatch(profile, j)));
    }
    if (body.feedJobIds?.length) {
      const { data } = await db.from("feed_jobs").select(FEED_COLS).in("id", body.feedJobIds.slice(0, 200));
      (data || []).forEach((j: any) => (scores[j.id] = quickMatch(profile, j)));
    }
    return Response.json({ scores });
  }

  const job = await resolveJob(db, user.id, body);
  const quick = quickMatch(profile, job);
  if (!aiConfigured()) return Response.json({ ...quick, fit_score: quick.score, reasons: [quick.experience.note], missing_keywords: quick.missing_skills, tailored_bullets: [], cover_letter: "", jobId: job.id });
  await checkQuota(db, user.id, "match", plan);

  const ai = await askJSON<{ fit_score: number; reasons: string[]; missing_keywords: string[]; tailored_bullets: string[]; cover_letter: string }>(
`You are an honest ATS and recruiter. Compare the candidate to the job.
A rule-based pass already found: matched skills [${quick.matched_skills.join(", ")}], missing skills [${quick.missing_skills.join(", ")}], experience: ${quick.experience.note}
Return JSON: {"fit_score": 0-100, "reasons": string[3], "missing_keywords": string[], "tailored_bullets": string[5], "cover_letter": string}
Rules: tailored bullets must only rephrase real experience/projects from the profile. Never invent skills, employers, or numbers. Cover letter under 180 words.

PROFILE: ${JSON.stringify(profile)}
JOB: ${job.title} at ${job.company} (${job.location || ""})
${job.description}`);

  const aiScore = Math.max(0, Math.min(100, Number(ai.fit_score) || 0));
  const score = Math.round(quick.score * 0.6 + aiScore * 0.4);
  const result = { ...ai, ...quick, score, fit_score: score, ai_score: aiScore, missing_keywords: [...new Set([...(quick.missing_skills || []), ...(ai.missing_keywords || [])])] };
  if (job.id) await db.from("jobs").update({ fit_score: score, missing_keywords: result.missing_keywords, tailored: result, match: quick }).eq("id", job.id).eq("user_id", user.id);
  await recordUsage(db, user.id, "match", { jobId: job.id });
  return Response.json({ ...result, jobId: job.id });
});

import { requireUser, handle, preflight, readJSON } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { atsScore } from "@/lib/ats";
import { profileText, promptProfile } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";
import { requireProfile, getJob, str } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

// POST { jobId } -> AI fit score with reasons + missing keywords (counts as 1 analysis).
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { jobId } = await readJSON<{ jobId?: string }>(req);
  const job = await getJob(db, user.id, jobId);
  const profile = await requireProfile(db, user.id);
  await assertQuota(db, user.id, "analysis");

  const ats = atsScore(job.description || job.title, profileText(profile));
  const ai = await askJSON<{ fit_score: number; verdict: string; reasons: string[]; gaps: string[]; missing_keywords: string[] }>(
`You are an honest recruiter screening an Indian fresher/student. Compare the candidate to the job.
Return JSON: {"fit_score": integer 0-100, "verdict": "one short sentence", "reasons": [3 short strengths, each citing a real profile fact], "gaps": [up to 3 honest gaps], "missing_keywords": [important JD skills/terms not in the profile]}
Be calibrated: 80+ only when most core requirements are clearly met. Never assume skills that are not in the profile.

PROFILE (data): ${JSON.stringify(promptProfile(profile))}
JOB (data): ${job.title} at ${job.company} (${job.location || ""})
${(job.description || "").slice(0, 8000)}`);

  const result = {
    fit_score: Math.max(0, Math.min(100, Math.round(Number(ai.fit_score) || 0))),
    verdict: str(ai.verdict, 240),
    reasons: (Array.isArray(ai.reasons) ? ai.reasons : []).slice(0, 4).map((r) => str(r, 240)).filter(Boolean),
    gaps: (Array.isArray(ai.gaps) ? ai.gaps : []).slice(0, 4).map((r) => str(r, 240)).filter(Boolean),
    missing_keywords: [...new Set([...(Array.isArray(ai.missing_keywords) ? ai.missing_keywords : []).map((k) => str(k, 60)), ...ats.missing])].filter(Boolean).slice(0, 15),
    ats
  };
  await db.from("jobs").update({ fit_score: result.fit_score, missing_keywords: result.missing_keywords, match: result }).eq("id", job.id).eq("user_id", user.id);
  await recordUsage(db, user.id, "analysis");
  return Response.json(result);
});

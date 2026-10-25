import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { promptProfile } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";
import { requireProfile, getJob, str, capWords } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

// POST { jobId, tone? } -> cover letter under 200 words, only real facts (counts as 1 cover letter).
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ jobId?: string; tone?: string }>(req);
  const job = await getJob(db, user.id, body.jobId);
  const profile = await requireProfile(db, user.id);
  await assertQuota(db, user.id, "cover_letter");
  const tone = ["warm", "formal", "concise"].includes(String(body.tone)) ? body.tone : "warm";

  const out = await askJSON<{ cover_letter: string }>(
`Write a ${tone}, specific cover letter for this Indian fresher/student. Rules:
- 140 to 190 words. Plain text, short paragraphs separated by blank lines. Start with "Dear Hiring Team," and end with "Regards," and the candidate's name.
- Use ONLY facts from the PROFILE. Never invent experience, numbers, employers, or skills. If a JD requirement is not in the profile, do not claim it.
- Mention 2 concrete profile facts that match the job and one line on why this company/role.
- No clichés like "I am writing to express my interest".
Return JSON: {"cover_letter": string}

PROFILE (data): ${JSON.stringify(promptProfile(profile))}
JOB (data): ${job.title} at ${job.company} (${job.location || ""})
${(job.description || "").slice(0, 6000)}`);

  const letter = capWords(str(out.cover_letter, 4000), 199);
  if (!letter) throw new HttpError(502, "The AI returned an empty letter. Please try again.");
  await db.from("jobs").update({ cover_letter: letter }).eq("id", job.id).eq("user_id", user.id);
  await recordUsage(db, user.id, "cover_letter");
  return Response.json({ cover_letter: letter });
});

// PUT { jobId, cover_letter } -> save the user's edited letter. Free.
export const PUT = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ jobId?: string; cover_letter?: string }>(req);
  const job = await getJob(db, user.id, body.jobId);
  const { error } = await db.from("jobs").update({ cover_letter: str(body.cover_letter, 4000) }).eq("id", job.id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ ok: true });
});

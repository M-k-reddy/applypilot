import { requireUser, handle, preflight, readJSON } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { promptProfile } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";
import { requireProfile, getJob, str } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

// POST { jobId } -> 8 likely interview questions with short answer pointers from the profile (counts as 1 analysis).
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { jobId } = await readJSON<{ jobId?: string }>(req);
  const job = await getJob(db, user.id, jobId);
  const profile = await requireProfile(db, user.id);
  await assertQuota(db, user.id, "analysis");

  const out = await askJSON<{ questions: { q: string; type: string; pointers: string[] }[] }>(
`Prepare an Indian fresher/student for an interview for this job.
Return JSON: {"questions": [exactly 8 items: {"q": "likely question", "type": "technical" | "project" | "hr" | "behavioural", "pointers": [2-3 short answer pointers that cite the candidate's REAL projects, skills or education; if the profile lacks something, say what to revise instead]}]}
Mix: 4 technical (from the JD's core skills), 2 about the candidate's own projects/experience, 2 HR/behavioural (include "Tell me about yourself").

PROFILE (data): ${JSON.stringify(promptProfile(profile))}
JOB (data): ${job.title} at ${job.company}
${(job.description || "").slice(0, 6000)}`);

  const questions = (Array.isArray(out.questions) ? out.questions : []).slice(0, 8).map((x) => ({
    q: str(x?.q, 300), type: ["technical", "project", "hr", "behavioural"].includes(x?.type) ? x.type : "technical",
    pointers: (Array.isArray(x?.pointers) ? x.pointers : []).slice(0, 3).map((p) => str(p, 240)).filter(Boolean)
  })).filter((x) => x.q);
  await db.from("jobs").update({ interview: { questions, generatedAt: new Date().toISOString() } }).eq("id", job.id).eq("user_id", user.id);
  await recordUsage(db, user.id, "analysis");
  return Response.json({ questions });
});

import { requireUser, handle, HttpError } from "@/lib/supabase";
import { runAtsChecks, profileToText } from "@/lib/ats";
import { tryAskJSON } from "@/lib/gemini";
import { loadProfile, resolveJob } from "@/lib/data";
import { checkQuota, recordUsage } from "@/lib/limits";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 POST { resumeText?, jd?, jobId?, feedJobId?, ai?: boolean }
 -> { score, grade, checks[{id,label,pass,detail,tip,weight,category}], keywords?, weak_bullets, stats, suggestions? }
 Rule checks are deterministic. AI suggestions are optional and never change the score.
 Uses the latest uploaded resume when resumeText is omitted.
*/
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const { plan, profile, rawText } = await loadProfile(db, user.id);
  await checkQuota(db, user.id, "ats", plan);

  const resumeText: string = (body.resumeText || rawText || profileToText(profile) || "").slice(0, 30000);
  if (resumeText.trim().length < 50) throw new HttpError(400, "Paste your resume text or upload a resume first");
  let jd: string | undefined = body.jd;
  if (!jd && (body.jobId || body.feedJobId)) jd = (await resolveJob(db, user.id, body)).description;

  const report = runAtsChecks(resumeText, jd);
  let suggestions: { summary: string; top_fixes: string[]; rewrites: { before: string; after: string }[] } | null = null;
  if (body.ai !== false) {
    const failed = report.checks.filter((c) => !c.pass).map((c) => `${c.label}: ${c.detail}`);
    suggestions = await tryAskJSON(
`You are a strict but kind resume reviewer for fresher tech roles. The rule-based ATS check found these failures:
${failed.join("\n") || "none"}
${report.keywords ? `Missing JD keywords: ${report.keywords.missing.join(", ")}` : ""}
Give the 5 highest-impact fixes and rewrite up to 3 weak bullets.
Rules: never invent employers, numbers, or skills. Where a metric would help but is not in the resume, use a placeholder like [X%] and say "fill only if true".
Return JSON: {"summary": string (2 sentences), "top_fixes": string[], "rewrites": [{"before": string, "after": string}]}

WEAK BULLETS: ${JSON.stringify(report.weak_bullets.slice(0, 5))}
RESUME:
${resumeText.slice(0, 12000)}`);
  }
  await db.from("ats_reports").insert({ user_id: user.id, score: report.score, report, jd: jd?.slice(0, 8000) ?? null });
  await recordUsage(db, user.id, "ats", { score: report.score });
  return Response.json({ ...report, suggestions });
});

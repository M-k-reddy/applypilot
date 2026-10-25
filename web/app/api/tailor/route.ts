import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { extractKeywords, hasTerm, norm } from "@/lib/ats";
import { profileText, type TailorEdit } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";
import { requireProfile, getJob, str, inventedNumbers } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

type Edit = TailorEdit;

// POST { jobId } -> proposes a summary rewrite + per-bullet rewrites using only real profile facts (counts as 1 tailor).
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { jobId } = await readJSON<{ jobId?: string }>(req);
  const job = await getJob(db, user.id, jobId);
  const profile = await requireProfile(db, user.id);
  await assertQuota(db, user.id, "tailor");

  const bullets: { id: string; section: "experience" | "projects"; item: number; bullet: number; text: string; context: string }[] = [];
  profile.experience.forEach((e, i) => e.bullets.forEach((b, j) => bullets.push({ id: `experience-${i}-${j}`, section: "experience", item: i, bullet: j, text: b, context: `${e.title} at ${e.company}` })));
  profile.projects.forEach((p, i) => p.bullets.forEach((b, j) => bullets.push({ id: `projects-${i}-${j}`, section: "projects", item: i, bullet: j, text: b, context: `Project ${p.name} (${p.tech.join(", ")})` })));
  if (!bullets.length && !profile.summary && !profile.skills.length) throw new HttpError(400, "Your profile has no bullets or summary to tailor. Add experience or projects in Profile.");

  const keywords = extractKeywords(`${job.title}\n${job.description || ""}`).map((k) => k.term);
  const out = await askJSON<{ summary: { new: string; reason: string }; edits: { id: string; new: string; reason: string }[] }>(
`You tailor a fresher's resume to a job. Rewrite to mirror the job's language ONLY where the candidate's real facts support it.
Hard rules:
- Use only facts present in the PROFILE. Never add tools, employers, metrics, numbers, dates or outcomes that are not already there.
- You may reorder, tighten, use stronger verbs, and use the JD's wording for a skill the candidate really has.
- Each bullet stays one line, under 30 words, starts with a verb, no first person.
- Propose edits only where they help (max 12). Skip bullets that are already good.
- summary.new: 2-3 sentences, under 60 words, built from the profile's real skills and education.
Return JSON: {"summary": {"new": string, "reason": string}, "edits": [{"id": "<bullet id from BULLETS>", "new": string, "reason": "which JD need this targets"}]}

JOB (data): ${job.title} at ${job.company}
JD KEYWORDS: ${keywords.join(", ")}
${(job.description || "").slice(0, 6000)}

CURRENT SUMMARY (data): ${profile.summary || "(none)"}
SKILLS (data): ${profile.skills.join(", ")}
EDUCATION (data): ${profile.education.map((e) => `${e.degree} ${e.field}, ${e.institution} ${e.end}`).join("; ")}
BULLETS (data): ${JSON.stringify(bullets.slice(0, 60).map((b) => ({ id: b.id, context: b.context, text: b.text })))}`);

  const source = profileText(profile);
  const srcNorm = norm(source);
  const check = (oldText: string, newText: string) => {
    const w: string[] = [];
    const nums = inventedNumbers(newText, `${source}\n${oldText}`);
    if (nums.length) w.push(`New number not in your profile: ${nums.join(", ")}`);
    const n = norm(newText);
    const added = keywords.filter((k) => hasTerm(n, k) && !hasTerm(srcNorm, k));
    if (added.length) w.push(`Mentions ${added.join(", ")}, which is not in your profile. Accept only if true.`);
    return w;
  };

  const edits: Edit[] = [];
  const sumNew = str(out.summary?.new, 600);
  if (sumNew && sumNew !== profile.summary) {
    const warnings = check(profile.summary, sumNew);
    if (!warnings.some((w) => w.startsWith("New number"))) edits.push({ id: "summary", section: "summary", item: 0, bullet: 0, old: profile.summary, new: sumNew, reason: str(out.summary?.reason, 200) || "Aligns your summary with this role", warnings });
  }
  const seen = new Set<string>();
  for (const e of Array.isArray(out.edits) ? out.edits.slice(0, 16) : []) {
    const b = bullets.find((x) => x.id === e?.id); const nt = str(e?.new, 400);
    if (!b || !nt || seen.has(b.id) || nt === b.text) continue; seen.add(b.id);
    const warnings = check(b.text, nt);
    if (warnings.some((w) => w.startsWith("New number"))) continue; // invented metrics are dropped outright
    edits.push({ id: b.id, section: b.section, item: b.item, bullet: b.bullet, old: b.text, new: nt, reason: str(e?.reason, 200), warnings });
  }

  const tailored = { generatedAt: new Date().toISOString(), keywords, edits, decisions: {} as Record<string, string>, overrides: {} as Record<string, string> };
  const { error } = await db.from("jobs").update({ tailored }).eq("id", job.id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  await recordUsage(db, user.id, "tailor");
  return Response.json({ tailored });
});

// PUT { jobId, decisions: {editId: "accepted"|"rejected"|"pending"}, overrides: {editId: text} } -> saves review state. Free.
export const PUT = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ jobId?: string; decisions?: Record<string, string>; overrides?: Record<string, string> }>(req);
  const job = await getJob(db, user.id, body.jobId);
  if (!job.tailored) throw new HttpError(400, "Generate tailored edits first");
  const ids = new Set<string>((job.tailored.edits || []).map((e: Edit) => e.id));
  const decisions: Record<string, string> = {}, overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.decisions || {})) if (ids.has(k) && ["accepted", "rejected", "pending"].includes(v)) decisions[k] = v;
  for (const [k, v] of Object.entries(body.overrides || {})) if (ids.has(k)) overrides[k] = str(v, 600);
  const tailored = { ...job.tailored, decisions, overrides };
  const { error } = await db.from("jobs").update({ tailored }).eq("id", job.id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ ok: true });
});

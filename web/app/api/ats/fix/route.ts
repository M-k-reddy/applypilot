import { requireUser, handle, HttpError } from "@/lib/supabase";
import { askJSON, aiConfigured } from "@/lib/gemini";
import { loadProfile } from "@/lib/data";
import { checkQuota, recordUsage } from "@/lib/limits";

export async function OPTIONS() { return new Response(null, { status: 204 }); }

// POST { bullet, jd?, role? } -> { rewrites: string[3], note }   "AI fix" for one weak bullet
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { bullet, jd, role } = await req.json();
  if (!bullet || String(bullet).trim().length < 8) throw new HttpError(400, "Send the bullet to rewrite");
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server");
  const { plan, profile } = await loadProfile(db, user.id);
  await checkQuota(db, user.id, "ats_fix", plan);

  const out = await askJSON<{ rewrites: string[]; note: string }>(
`Rewrite this resume bullet 3 ways for an ATS and a recruiter.
Rules: start with a strong action verb; one line (max 28 words); keep every fact true to the original and the profile;
NEVER invent numbers, tools, or outcomes. If a metric would help, insert a placeholder like [X%] or [N users].
${role ? `Target role: ${role}` : ""}
${jd ? `Prefer the JD's wording where it is true:\n${String(jd).slice(0, 3000)}` : ""}
Return JSON: {"rewrites": [string, string, string], "note": "one short sentence on what changed; mention placeholders must be filled only if true"}

BULLET: ${String(bullet).slice(0, 600)}
PROFILE SKILLS: ${(profile?.skills || []).join(", ")}`);
  await recordUsage(db, user.id, "ats_fix");
  return Response.json({ rewrites: (out.rewrites || []).slice(0, 3), note: out.note || "" });
});

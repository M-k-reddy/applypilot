import { requireUser, handle, HttpError } from "@/lib/supabase";
import { askJSON, aiConfigured } from "@/lib/gemini";
import { loadProfile, resolveJob } from "@/lib/data";
import { checkQuota, recordUsage } from "@/lib/limits";
import { renderResumeHtml, TailoredResume } from "@/lib/resumeHtml";
import { extractSkills } from "@/lib/skills";
import { profileToText } from "@/lib/ats";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 POST { jobId | feedJobId | job: {title, company, description} }
 -> { id, resume (JSON), html (ATS-safe single column, print to PDF), dropped_skills, notes }
 GET ?id=... -> the saved tailored resume
*/
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await req.json();
  const { plan, profile } = await loadProfile(db, user.id);
  if (!profile) throw new HttpError(400, "Upload your resume first");
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server");
  await checkQuota(db, user.id, "tailor", plan);
  const job = await resolveJob(db, user.id, body);

  const ai = await askJSON<Partial<TailoredResume> & { notes?: string[] }>(
`Tailor this candidate's resume to the job. Output a complete one-page resume as JSON.
STRICT RULES:
- Use ONLY facts in PROFILE. Never invent employers, titles, dates, degrees, numbers, tools or outcomes.
- You may: reorder sections' items by relevance, rephrase bullets with stronger verbs and the JD's wording where true, drop irrelevant items, pick the 2-4 most relevant projects, order skills so JD-relevant ones come first.
- Max 4 bullets per role/project, each one line (<= 28 words). Summary <= 2 sentences naming the target role.
- "notes": 2-4 short tips telling the candidate what else they could add if true (e.g. a metric).
Return JSON with keys: headline, summary, skills (string[]), experience [{title, company, start, end, bullets}], projects [{name, tech, bullets, link}], education [{degree, field, institution, start, end, grade}], achievements (string[]), certifications (string[]), notes (string[]).

JOB: ${job.title} at ${job.company}
${job.description.slice(0, 8000)}

PROFILE: ${JSON.stringify(profile)}`);

  // Safety: contact details always come from the parsed profile, never from the model.
  // Skills the model added that are not anywhere in the profile get dropped and reported.
  const profileText = (profileToText(profile) + "\n" + (profile.skills || []).join(", ")).toLowerCase();
  const profileSkills = new Set(extractSkills(profileText));
  const skills: string[] = []; const dropped: string[] = [];
  for (const s of ai.skills || []) {
    const canon = extractSkills(s);
    const ok = profileText.includes(String(s).toLowerCase()) || (canon.length > 0 && canon.every((c) => profileSkills.has(c)));
    (ok ? skills : dropped).push(s);
  }
  const resume: TailoredResume = {
    full_name: profile.full_name || "", email: profile.email || "", phone: profile.phone || "", location: profile.location || "",
    linkedin: profile.linkedin, github: profile.github, portfolio: profile.portfolio,
    headline: ai.headline || profile.headline || "", summary: ai.summary || profile.summary || "", skills,
    experience: ai.experience || profile.experience || [], projects: ai.projects || profile.projects || [],
    education: profile.education?.length ? profile.education : ai.education || [],
    achievements: ai.achievements || profile.achievements || [], certifications: ai.certifications || profile.certifications || []
  };
  const html = renderResumeHtml(resume);
  const { data: row } = await db.from("tailored_resumes").insert({
    user_id: user.id, job_id: job.id ?? null, title: job.title, company: job.company, resume, html
  }).select("id").single();
  await recordUsage(db, user.id, "tailor", { jobId: job.id });
  return Response.json({ id: row?.id, resume, html, dropped_skills: dropped, notes: ai.notes || [] });
});

export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const { data } = await db.from("tailored_resumes").select("id, title, company, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    return Response.json({ items: data || [] });
  }
  const { data } = await db.from("tailored_resumes").select("*").eq("id", id).eq("user_id", user.id).single();
  if (!data) throw new HttpError(404, "Not found");
  return Response.json(data);
});

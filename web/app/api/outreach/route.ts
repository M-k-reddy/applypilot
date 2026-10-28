import { requireUser, handle, HttpError } from "@/lib/supabase";
import { askJSON, aiConfigured } from "@/lib/gemini";
import { loadProfile, resolveJob } from "@/lib/data";
import { checkQuota, recordUsage } from "@/lib/limits";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 "Super Apply": POST { jobId | feedJobId | job: {title, company, description, url}, recipient?: {name, title?, email?}, kind?: "hiring" | "referral" }
 -> { email_subject, email_body, linkedin_note (<= 300 chars), referral_note, mailto }
 Nothing is sent. The user sends from their own inbox (mailto:) or pastes the note on LinkedIn.
*/
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await req.json();
  const { plan, profile } = await loadProfile(db, user.id);
  if (!profile) throw new HttpError(400, "Upload your resume first");
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server");
  await checkQuota(db, user.id, "outreach", plan);
  const job = await resolveJob(db, user.id, body);
  const r = body.recipient || {};
  const firstName = String(r.name || "").trim().split(/\s+/)[0] || "";

  const out = await askJSON<{ email_subject: string; email_body: string; linkedin_note: string; referral_note: string }>(
`Write outreach for a job candidate. Plain, warm, specific, no flattery, no clichés, no emojis.
Use ONLY facts from the profile; never invent experience, numbers or mutual connections.
1. email_subject: <= 9 words, includes the role.
2. email_body: cold email to ${firstName || "the hiring team"} (${r.title || "hiring team"}) at ${job.company}: greeting, 1 line on why this role, 2 short lines of the most relevant proof (projects/skills that match the JD), a clear ask (a short chat or to consider the application), sign-off with the candidate's name, phone and LinkedIn. Under 120 words.
3. linkedin_note: connection note under 280 characters to ${firstName || "the recruiter"}, mention the role and one proof point.
4. referral_note: message to an employee asking for a referral for this role (job link if known), under 280 characters, easy to say yes to.
Return JSON: {"email_subject": string, "email_body": string, "linkedin_note": string, "referral_note": string}

JOB: ${job.title} at ${job.company} ${job.apply_url || ""}
${job.description.slice(0, 5000)}
PROFILE: ${JSON.stringify({ name: profile.full_name, phone: profile.phone, linkedin: profile.linkedin, github: profile.github, headline: profile.headline, skills: profile.skills, projects: profile.projects, experience: profile.experience, education: profile.education, achievements: profile.achievements })}`);

  const cap = (s: string) => (s || "").length <= 300 ? s || "" : s.slice(0, 297).replace(/\s+\S*$/, "") + "…";
  const to = r.email ? encodeURIComponent(String(r.email)) : "";
  const mailto = `mailto:${to}?subject=${encodeURIComponent(out.email_subject || "")}&body=${encodeURIComponent(out.email_body || "")}`;
  await recordUsage(db, user.id, "outreach", { company: job.company });
  return Response.json({ email_subject: out.email_subject, email_body: out.email_body, linkedin_note: cap(out.linkedin_note), referral_note: cap(out.referral_note), mailto });
});

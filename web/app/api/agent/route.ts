import { requireUser, handle, HttpError } from "@/lib/supabase";
import { askJSON } from "@/lib/gemini";
import { checkQuota, recordUsage } from "@/lib/limits";

/*
 The brain of the extension.
 POST { url, pageTitle, fields: [{id, label, type, options?, required}] }
 -> { actions: [{id, action: "fill"|"select"|"check"|"upload_resume"|"ask_user", value?, reason?}] }
 The agent NEVER returns a submit action. The user clicks Submit.
*/
type Field = { id: string; label: string; type: string; options?: string[]; required?: boolean };

export async function OPTIONS() { return new Response(null, { status: 204 }); }

export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { url, pageTitle, fields } = (await req.json()) as { url: string; pageTitle: string; fields: Field[] };
  if (!Array.isArray(fields) || !fields.length) throw new HttpError(400, "No form fields found on this page");

  const { data: prof } = await db.from("profiles").select("plan, profile_json").eq("id", user.id).single();
  if (!prof?.profile_json) throw new HttpError(400, "Upload your resume in the dashboard first");

  // Free plan: monthly autofill cap (FREE_MONTHLY_LIMIT, default 5), counted in usage_events
  await checkQuota(db, user.id, "autofill", prof.plan);

  const out = await askJSON<{ company: string; title: string; actions: any[] }>(
`You fill job application forms for a candidate. Use ONLY facts from the profile.
For each field return one action:
- "fill" with value for text/textarea/email/tel/number/date
- "select" with value exactly equal to one of the options
- "check" with value "true"/"false" for checkbox/radio
- "upload_resume" for file inputs asking for a resume/CV
- "ask_user" with a short reason when the answer is unknown, is salary/CTC, a password, a legal/sensitive question (disability, gender, caste, criminal record), or an essay the profile cannot honestly answer.
Never invent experience. Skip fields that are irrelevant (search boxes, newsletter).
Also guess "company" and "title" of the job from the page.
Return JSON: {"company": string, "title": string, "actions": [{"id": string, "action": string, "value": string, "reason": string}]}

PAGE: ${pageTitle} ${url}
PROFILE: ${JSON.stringify(prof.profile_json)}
FIELDS: ${JSON.stringify(fields.slice(0, 120))}`);

  const actions = (out.actions || []).filter((a) => a.action !== "submit");
  // If the user saved this job earlier (tracker), move that card to "filled" instead of creating a duplicate.
  const { data: saved } = await db.from("applications").select("id").eq("user_id", user.id).eq("page_url", url).eq("status", "saved").limit(1).maybeSingle();
  const { data: app } = saved
    ? await db.from("applications").update({ status: "filled", actions, updated_at: new Date().toISOString() }).eq("id", saved.id).select("id").single()
    : await db.from("applications").insert({
        user_id: user.id, page_url: url, company: out.company, title: out.title, status: "filled", actions, source: "autofill"
      }).select("id").single();

  await recordUsage(db, user.id, "autofill", { url });

  return Response.json({ applicationId: app?.id, company: out.company, title: out.title, actions });
});

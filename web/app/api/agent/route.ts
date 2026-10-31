import { requireUser, handle, HttpError } from "@/lib/supabase";
import { askJSON } from "@/lib/gemini";
import { checkQuota, recordUsage } from "@/lib/limits";

/*
 The brain of the extension.
 POST { url, pageTitle, fields: [{id, label, type, options?, required}] }
 -> { actions: [{id, action: "fill"|"select"|"check"|"upload_resume"|"ask_user", value?, reason?}] }
 Multi-step forms (LinkedIn Easy Apply, Indeed, Naukri chatbot) send { applicationId } on steps 2+,
 so one application = one row and one unit of quota. The agent never returns a submit action;
 the extension's One-click Apply decides that from the user's Auto-submit setting.
*/
type Field = { id: string; label: string; type: string; options?: string[]; required?: boolean };

export async function OPTIONS() { return new Response(null, { status: 204 }); }

export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { url, pageTitle, fields, applicationId, answers, auto } = (await req.json()) as { url: string; pageTitle: string; fields: Field[]; applicationId?: string; answers?: string; auto?: boolean };
  if (!Array.isArray(fields) || !fields.length) throw new HttpError(400, "No form fields found on this page");

  const { data: prof } = await db.from("profiles").select("plan, profile_json").eq("id", user.id).single();
  if (!prof?.profile_json) throw new HttpError(400, "Upload your resume in the dashboard first");

  // Free plan: monthly autofill cap (FREE_MONTHLY_LIMIT, default 5), counted in usage_events
  // Continuing step of the same application: no new row, no extra quota.
  let cont: { id: string } | null = null;
  if (applicationId) cont = (await db.from("applications").select("id").eq("id", applicationId).eq("user_id", user.id).maybeSingle()).data;
  if (!cont) await checkQuota(db, user.id, "autofill", prof.plan);

  const out = await askJSON<{ company: string; title: string; actions: any[] }>(
`You fill job application forms for a candidate. Use ONLY facts from the profile.
For each field return one action:
- "fill" with value for text/textarea/email/tel/number/date
- "select" with value exactly equal to one of the options
- "check" with value "true"/"false" for checkbox/radio
- "upload_resume" for file inputs asking for a resume/CV
- "ask_user" with a short reason when the answer is unknown, is salary/CTC, a password, a legal/sensitive question (disability, gender, caste, criminal record), or an essay the profile cannot honestly answer.
Never invent experience. If STANDARD ANSWERS cover a question (notice period, CTC, relocation, work authorisation,
years with a tool that is not in the profile), use them instead of asking. Skip fields that are irrelevant (search boxes, newsletter).
${auto ? `AUTOPILOT MODE: the candidate is not watching, so answer every field you honestly can instead of asking:
- yes/no or "years of experience with X": use the profile; a tool not in the profile is 0 years (or "No").
- voluntary diversity/disability/veteran questions: pick "Prefer not to say"/"Decline to self-identify" if offered.
- short "why do you want this job"/cover text: write 2 honest sentences from the profile.
- current CTC for this fresher: 0. Expected CTC, notice period, relocation: from STANDARD ANSWERS.
- anything else: pick the closest honest answer from PROFILE + STANDARD ANSWERS (for a select, the closest option; for a number, the closest figure).
NEVER use "ask_user" except for a password or a non-resume file upload.
` : ""}Also guess "company" and "title" of the job from the page.
Return JSON: {"company": string, "title": string, "actions": [{"id": string, "action": string, "value": string, "reason": string}]}

PAGE: ${pageTitle} ${url}
PROFILE: ${JSON.stringify(prof.profile_json)}
STANDARD ANSWERS (written by the candidate): ${String(answers || "none").slice(0, 2000)}
FIELDS: ${JSON.stringify(fields.slice(0, 120))}`);

  const actions = (out.actions || []).filter((a) => a.action !== "submit");
  // If the user saved this job earlier (tracker), move that card to "filled" instead of creating a duplicate.
  if (cont) {
    await db.from("applications").update({ actions, updated_at: new Date().toISOString() }).eq("id", cont.id);
    return Response.json({ applicationId: cont.id, company: out.company, title: out.title, actions });
  }
  const { data: saved } = await db.from("applications").select("id").eq("user_id", user.id).eq("page_url", url).eq("status", "saved").limit(1).maybeSingle();
  const { data: app } = saved
    ? await db.from("applications").update({ status: "filled", actions, updated_at: new Date().toISOString() }).eq("id", saved.id).select("id").single()
    : await db.from("applications").insert({
        user_id: user.id, page_url: url, company: out.company, title: out.title, status: "filled", actions, source: "autofill"
      }).select("id").single();

  await recordUsage(db, user.id, "autofill", { url });

  return Response.json({ applicationId: app?.id, company: out.company, title: out.title, actions });
});

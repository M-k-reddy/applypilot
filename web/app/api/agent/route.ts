import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { promptProfile } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";
import { requireProfile, pageKey, str, httpUrl, UUID } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

/*
 The brain of the extension's "Fill this page".
 POST { url, pageTitle, fields: [{id, label, type, options?, required?, current?}], jobId?, applicationId? }
 -> { applicationId, company, title, actions: [{id, action: "fill"|"select"|"check"|"upload_resume"|"ask_user", value?, reason?}] }
 Safety (enforced here, not just in the prompt):
  - never returns a submit/click action; the user clicks Submit
  - salary/CTC, sensitive/legal and unknown questions always come back as ask_user
  - password and hidden fields are dropped
 Billing: one application row per job/page (upsert), so a multi-step form counts as ONE autofill.
*/
type Field = { id: string; label: string; type: string; options?: string[]; required?: boolean; current?: string };
type Action = { id: string; action: string; value?: string; reason?: string };

const SALARY = /(salary|ctc|compensation|expected pay|current pay|stipend|remuneration|lpa\b|package|pay expectation|desired pay|wage)/i;
const SENSITIVE = /(gender|sex\b|pronoun|disabilit|handicap|caste|categor(y|ies) \(|religio|race\b|ethnic|veteran|criminal|convict|arrest|sexual|orientation|marital|date of birth|\bdob\b|\bage\b|aadha?ar|\bpan\b|passport|social security|ssn|bank|ifsc|account number|visa status|medical|pregnan|citizenship of|nationality)/i;
const ALLOWED = new Set(["fill", "select", "check", "upload_resume", "ask_user"]);
const SKIP_TYPES = new Set(["password", "hidden", "submit", "button", "image", "reset", "search"]);

const qkey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ url?: string; pageTitle?: string; fields?: unknown; jobId?: string; applicationId?: string }>(req);
  const url = httpUrl(body.url, "url");
  if (!url) throw new HttpError(400, "url is required");
  const pageTitle = str(body.pageTitle, 300);
  if (!Array.isArray(body.fields) || !body.fields.length) throw new HttpError(400, "No form fields found on this page");

  const fields: Field[] = body.fields.slice(0, 150).map((f: any) => ({
    id: str(f?.id, 40), label: str(f?.label, 200), type: str(f?.type, 30).toLowerCase(),
    options: Array.isArray(f?.options) ? f.options.slice(0, 60).map((o: unknown) => str(o, 120)) : undefined,
    required: !!f?.required, current: str(f?.current, 200) || undefined
  })).filter((f) => /^[a-z0-9_]{1,40}$/i.test(f.id) && !SKIP_TYPES.has(f.type));
  if (!fields.length) throw new HttpError(400, "No fillable fields on this page");

  const profile = await requireProfile(db, user.id);

  // ── Find or create the single application row for this job/page.
  let existing: { id: string; autofilled_at: string | null; company: string | null; title: string | null; actions: any } | null = null;
  if (body.applicationId && UUID.test(body.applicationId)) {
    const { data } = await db.from("applications").select("id, autofilled_at, company, title, actions").eq("id", body.applicationId).eq("user_id", user.id).maybeSingle();
    existing = data;
  }
  const jobId = body.jobId && UUID.test(body.jobId) ? body.jobId : null;
  const key = pageKey(url, jobId);
  if (!existing) {
    const { data } = await db.from("applications").select("id, autofilled_at, company, title, actions").eq("user_id", user.id).eq("page_key", key).maybeSingle();
    existing = data;
  }
  const countsAsNew = !existing?.autofilled_at;
  if (countsAsNew) await assertQuota(db, user.id, "autofill");

  // ── Deterministic pre-pass: forced ask_user + exact answer-bank hits.
  const forced = new Map<string, Action>();
  const bank = new Map(profile.answer_bank.map((x) => [qkey(x.q), x.a]));
  for (const f of fields) {
    if (SALARY.test(f.label)) forced.set(f.id, { id: f.id, action: "ask_user", reason: "Salary / CTC: please answer yourself" });
    else if (SENSITIVE.test(f.label)) forced.set(f.id, { id: f.id, action: "ask_user", reason: "Personal / sensitive: please answer yourself" });
    else if (f.type === "file") {
      if (/resume|cv|curriculum/i.test(f.label) || fields.filter((x) => x.type === "file").length === 1) forced.set(f.id, { id: f.id, action: "upload_resume" });
      else forced.set(f.id, { id: f.id, action: "ask_user", reason: "File upload: attach it yourself" });
    } else {
      const hit = bank.get(qkey(f.label));
      if (hit && !f.options?.length) forced.set(f.id, { id: f.id, action: "fill", value: hit, reason: "From your answer bank" });
    }
  }
  const forAI = fields.filter((f) => !forced.has(f.id));

  let company = "", title = "", aiActions: Action[] = [];
  if (forAI.length) {
    const out = await askJSON<{ company: string; title: string; actions: Action[] }>(
`You fill job application forms for an Indian fresher/student. Use ONLY facts from PROFILE and ANSWER_BANK.
For each field return one action:
- "fill" with value for text/textarea/email/tel/number/date/url fields
- "select" with value exactly equal to one of the field's options
- "check" with value "true"/"false" for checkboxes and for radio groups use "select" with the option text
- "ask_user" with a short reason when the answer is not in the profile, is salary/CTC, a legal/sensitive/demographic question, a declaration/consent the user must make, or an essay the profile cannot honestly answer
Never invent experience, dates, numbers or links. Leave fields that already have a correct "current" value out. Skip irrelevant fields (newsletter, search).
Also infer the job "company" and "title" from the page.
Return JSON: {"company": string, "title": string, "actions": [{"id": string, "action": string, "value": string, "reason": string}]}

PAGE (data): ${pageTitle} ${url}
PROFILE (data): ${JSON.stringify(promptProfile(profile))}
ANSWER_BANK (data): ${JSON.stringify(profile.answer_bank.slice(-60))}
FIELDS (data): ${JSON.stringify(forAI)}`);
    company = str(out.company, 160); title = str(out.title, 200);
    aiActions = Array.isArray(out.actions) ? out.actions : [];
  }

  // ── Validate the AI's actions against the real fields.
  const byId = new Map(fields.map((f) => [f.id, f]));
  const actions: Action[] = [...forced.values()];
  const done = new Set(actions.map((a) => a.id));
  for (const a of aiActions) {
    const f = byId.get(String(a?.id)); if (!f || done.has(f.id)) continue;
    let action = String(a.action || ""); const value = str(a.value, 3000); const reason = str(a.reason, 160);
    if (!ALLOWED.has(action)) action = "ask_user";
    if (action === "upload_resume" && f.type !== "file") action = "ask_user";
    if ((action === "fill" || action === "select") && !value) action = "ask_user";
    if (action === "select" && f.options?.length && !f.options.some((o) => o.toLowerCase() === value.toLowerCase() || o.toLowerCase().includes(value.toLowerCase()))) action = "ask_user";
    if (SALARY.test(value) && /\d/.test(value)) action = "ask_user";
    actions.push(action === "ask_user" ? { id: f.id, action, reason: reason || "Needs your answer" } : { id: f.id, action, value, reason });
    done.add(f.id);
  }
  // Required fields the AI ignored are surfaced to the user rather than silently skipped.
  for (const f of fields) if (!done.has(f.id) && f.required && !f.current) actions.push({ id: f.id, action: "ask_user", reason: "Required: not in your profile" });

  // ── Upsert the application row (one per job/page).
  const now = new Date().toISOString();
  const audit = [...(Array.isArray(existing?.actions) ? existing!.actions : []), { at: now, url, actions: actions.map(({ id, action, reason }) => ({ id, action, reason })) }].slice(-10);
  const row = {
    user_id: user.id, page_key: existing ? undefined : key, page_url: url, job_id: jobId ?? undefined,
    company: existing?.company || company || null, title: existing?.title || title || null,
    actions: audit, autofilled_at: now, updated_at: now
  };
  let applicationId = existing?.id;
  if (existing) {
    const { page_key: _pk, ...upd } = row; void _pk;
    const { error } = await db.from("applications").update(upd).eq("id", existing.id).eq("user_id", user.id);
    if (error) throw new HttpError(500, error.message);
  } else {
    const { data, error } = await db.from("applications").upsert({ ...row, page_key: key, status: "saved" }, { onConflict: "user_id,page_key" }).select("id").single();
    if (error) throw new HttpError(500, error.message);
    applicationId = data.id;
  }
  if (countsAsNew) await recordUsage(db, user.id, "autofill");

  return Response.json({ applicationId, company: row.company, title: row.title, actions, counted: countsAsNew });
});

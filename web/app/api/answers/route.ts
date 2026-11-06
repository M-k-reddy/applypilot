import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { normalizeProfile, emptyProfile } from "@/lib/profile";
import { str } from "@/lib/server";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const SENSITIVE = /(salary|ctc|compensation|pay\b|stipend|password|ssn|aadhaar|aadhar|pan\b|passport|bank|account number|ifsc|otp)/i;

// POST { answers: [{q, a}] } -> merges into the profile's answer bank (same question = overwrite).
// Used by the extension's "Save my answers". Salary and ID numbers are never stored.
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const body = await readJSON<{ answers?: unknown }>(req);
  if (!Array.isArray(body.answers) || !body.answers.length) throw new HttpError(400, "answers must be a non-empty list");
  const incoming = body.answers.slice(0, 50).map((x: any) => ({ q: str(x?.q, 300, "question"), a: str(x?.a, 2000, "answer") }))
    .filter((x) => x.q && x.a && !SENSITIVE.test(x.q));

  const { data } = await db.from("profiles").select("profile_json, unanswered").eq("id", user.id).maybeSingle();
  const profile = data?.profile_json ? normalizeProfile(data.profile_json) : emptyProfile();
  const keyOf = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const map = new Map(profile.answer_bank.map((x) => [keyOf(x.q), x]));
  for (const x of incoming) map.set(keyOf(x.q), x);
  profile.answer_bank = [...map.values()].slice(-200);

  // Answered questions leave the Board Auto-Apply "unanswered" list (v2.4).
  const done = new Set(incoming.map((x) => keyOf(x.q)));
  const unanswered = (Array.isArray(data?.unanswered) ? data!.unanswered : []).filter((x: any) => x?.q && !done.has(keyOf(String(x.q))));
  const { error } = await db.from("profiles").update({ profile_json: profile, unanswered, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ saved: incoming.length, skipped: body.answers.length - incoming.length, total: profile.answer_bank.length });
});

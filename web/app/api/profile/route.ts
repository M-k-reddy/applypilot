import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { normalizeProfile, emptyProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// GET -> { profile, preferences }
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { data, error } = await db.from("profiles").select("profile_json, preferences").eq("id", user.id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return Response.json({ profile: data?.profile_json ? normalizeProfile(data.profile_json) : emptyProfile(), preferences: data?.preferences || {}, exists: !!data?.profile_json });
});

// PUT { profile, preferences? } -> saves the edited profile / answer sheet (only these two columns are writable).
export const PUT = handle(async (req) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const body = await readJSON<{ profile?: unknown; preferences?: unknown }>(req);
  if (!body.profile || typeof body.profile !== "object") throw new HttpError(400, "profile is required");
  if (JSON.stringify(body.profile).length > 200_000) throw new HttpError(413, "Profile is too large");
  const profile = normalizeProfile(body.profile);
  const update: Record<string, unknown> = { profile_json: profile, updated_at: new Date().toISOString() };
  if (body.preferences && typeof body.preferences === "object" && JSON.stringify(body.preferences).length < 5000) update.preferences = body.preferences;
  const { error } = await db.from("profiles").upsert({ id: user.id, ...update }, { onConflict: "id" });
  if (error) throw new HttpError(500, error.message);
  return Response.json({ profile });
});

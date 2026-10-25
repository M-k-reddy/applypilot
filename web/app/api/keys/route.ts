import crypto from "crypto";
import { requireUser, handle, preflight, readJSON, HttpError, sha256 } from "@/lib/supabase";
import { str, uuid } from "@/lib/server";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// Key management is dashboard-only (JWT). API keys cannot mint or list keys.
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const { data, error } = await db.from("api_keys").select("id, name, prefix, created_at, last_used").eq("user_id", user.id).is("revoked_at", null).order("created_at", { ascending: false });
  if (error) throw new HttpError(500, error.message);
  return Response.json({ keys: data || [] });
});

// POST { name? } -> { key } shown ONCE. Only its sha256 hash is stored.
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const body = await readJSON<{ name?: string }>(req).catch(() => ({} as { name?: string }));
  const { count } = await db.from("api_keys").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("revoked_at", null);
  if ((count ?? 0) >= 5) throw new HttpError(400, "You already have 5 active keys. Revoke one first.");
  const key = "ap_" + crypto.randomBytes(32).toString("base64url");
  const { data, error } = await db.from("api_keys").insert({
    user_id: user.id, name: str(body.name, 60) || "Chrome extension", prefix: key.slice(0, 10), key_hash: sha256(key)
  }).select("id, name, prefix, created_at, last_used").single();
  if (error) throw new HttpError(500, error.message);
  return Response.json({ key, record: data });
});

// DELETE ?id=... -> revoke
export const DELETE = handle(async (req) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const id = uuid(new URL(req.url).searchParams.get("id"));
  const { error } = await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ ok: true });
});

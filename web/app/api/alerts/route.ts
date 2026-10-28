import { requireUser, handle, HttpError } from "@/lib/supabase";

export async function OPTIONS() { return new Response(null, { status: 204 }); }

// GET -> { alerts }   POST { keywords, location?, remote?, fresher?, email? } -> { alert }   DELETE ?id=
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { data } = await db.from("alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  return Response.json({ alerts: data || [] });
});

export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const b = await req.json();
  const keywords = String(b.keywords || "").trim().slice(0, 200);
  if (!keywords) throw new HttpError(400, "Add at least one keyword, e.g. 'ML intern, data analyst'");
  const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= 10) throw new HttpError(400, "Up to 10 alerts per account");
  const { data, error } = await db.from("alerts").insert({
    user_id: user.id, keywords, location: String(b.location || "").slice(0, 120), remote: !!b.remote,
    fresher: b.fresher !== false, email: b.email !== false, active: true
  }).select("*").single();
  if (error) throw new HttpError(500, error.message);
  return Response.json({ alert: data });
});

export const DELETE = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing id");
  await db.from("alerts").delete().eq("id", id).eq("user_id", user.id);
  return Response.json({ ok: true });
});

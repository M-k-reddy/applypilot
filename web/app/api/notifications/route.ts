import { requireUser, handle } from "@/lib/supabase";

export async function OPTIONS() { return new Response(null, { status: 204 }); }

// GET ?unread=true -> { notifications, unread }    POST { ids?: string[], all?: true } marks read
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "true";
  let q = db.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
  if (unreadOnly) q = q.eq("read", false);
  const [{ data }, { count }] = await Promise.all([
    q, db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false)
  ]);
  return Response.json({ notifications: data || [], unread: count ?? 0 });
});

export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { ids, all } = await req.json();
  let q = db.from("notifications").update({ read: true }).eq("user_id", user.id);
  if (!all) q = q.in("id", (ids || []).slice(0, 200));
  await q;
  return Response.json({ ok: true });
});

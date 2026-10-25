import { requireUser, handle, preflight, HttpError } from "@/lib/supabase";
import { getJob, uuid } from "@/lib/server";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = handle(async (req, ctx) => {
  const { user, db } = await requireUser(req);
  return Response.json({ job: await getJob(db, user.id, ctx?.params?.id) });
});

export const DELETE = handle(async (req, ctx) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const { error } = await db.from("jobs").delete().eq("id", uuid(ctx?.params?.id)).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ ok: true });
});

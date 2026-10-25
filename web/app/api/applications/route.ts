import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { str, uuid, httpUrl } from "@/lib/server";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const STATUSES = ["saved", "applied", "interview", "offer", "rejected"];
const LEGACY: Record<string, string> = { filled: "saved", submitted: "applied" };

export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { data, error } = await db.from("applications")
    .select("id, job_id, company, title, page_url, status, notes, follow_up, position, created_at, updated_at, applied_at, autofilled_at")
    .eq("user_id", user.id).order("position", { ascending: true }).order("updated_at", { ascending: false }).limit(500);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ applications: data || [] });
});

// POST { id, status?, notes?, follow_up?, position? } -> update a card
// POST { company, title, page_url?, status? } (no id)     -> add a card manually
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const b = await readJSON<any>(req);
  const status = b.status != null ? (LEGACY[b.status] || b.status) : undefined;
  if (status !== undefined && !STATUSES.includes(status)) throw new HttpError(400, "Bad status");
  const now = new Date().toISOString();

  if (!b.id) {
    const company = str(b.company, 160), title = str(b.title, 200);
    if (!company && !title) throw new HttpError(400, "Add a company or a role");
    const { data, error } = await db.from("applications").insert({
      user_id: user.id, company, title, page_url: httpUrl(b.page_url, "page_url") || null, status: status || "saved",
      page_key: `manual:${crypto.randomUUID()}`, notes: str(b.notes, 4000) || null, updated_at: now, applied_at: status === "applied" ? now : null
    }).select("*").single();
    if (error) throw new HttpError(500, error.message);
    return Response.json({ application: data });
  }

  const upd: Record<string, unknown> = { updated_at: now };
  if (status) { upd.status = status; if (status === "applied") upd.applied_at = now; }
  if (b.notes !== undefined) upd.notes = str(b.notes, 4000);
  if (b.follow_up !== undefined) {
    if (b.follow_up && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.follow_up))) throw new HttpError(400, "follow_up must be YYYY-MM-DD");
    upd.follow_up = b.follow_up || null;
  }
  if (b.position !== undefined) { const p = Number(b.position); if (!Number.isFinite(p)) throw new HttpError(400, "Bad position"); upd.position = p; }
  const { data, error } = await db.from("applications").update(upd).eq("id", uuid(b.id)).eq("user_id", user.id).select("id").maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Application not found");
  return Response.json({ ok: true });
});

// DELETE ?id=... -> remove a card. Usage already counted stays counted (quota lives in usage_events).
export const DELETE = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const id = uuid(new URL(req.url).searchParams.get("id"));
  const { error } = await db.from("applications").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ ok: true });
});

import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { normalizeAutoSettings, normalizeBoardStatus, istMidnightISO } from "@/lib/autosettings";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// Zero-click auto-apply (v2.4). API key (extension, read-only) or dashboard JWT.
// GET  -> { settings, board_status, today: { applied, needs_review }, unanswered }
// PUT  { settings } -> { settings }   (dashboard sign-in only)
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const since = istMidnightISO();
  const [{ data: prof, error }, applied, review] = await Promise.all([
    db.from("profiles").select("auto_settings, board_status, unanswered").eq("id", user.id).maybeSingle(),
    db.from("applications").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("board", "is", null).eq("status", "applied").gte("applied_at", since),
    db.from("applications").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("board", "is", null).eq("status", "needs_review").gte("autofilled_at", since)
  ]);
  if (error) throw new HttpError(500, error.message);
  return Response.json({
    settings: normalizeAutoSettings(prof?.auto_settings),
    board_status: normalizeBoardStatus(prof?.board_status),
    today: { applied: applied.count || 0, needs_review: review.count || 0 },
    unanswered: Array.isArray(prof?.unanswered) ? prof!.unanswered : []
  });
});

export const PUT = handle(async (req) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const b = await readJSON<{ settings?: unknown }>(req);
  if (!b.settings || typeof b.settings !== "object") throw new HttpError(400, "settings is required");
  const settings = normalizeAutoSettings(b.settings);
  const { error } = await db.from("profiles").update({ auto_settings: settings, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw new HttpError(500, error.message);
  return Response.json({ settings });
});

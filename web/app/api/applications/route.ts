import { requireUser, handle, HttpError } from "@/lib/supabase";
import { ensureUserJob } from "@/lib/data";

export async function OPTIONS() { return new Response(null, { status: 204 }); }

/** Pipeline: saved -> filled (agent filled the form) -> applied -> interview -> offer | rejected */
const STATUSES = ["saved", "filled", "applied", "interview", "offer", "rejected"] as const;
const ALIAS: Record<string, string> = { submitted: "applied" }; // older extension builds send "submitted"

export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { data } = await db.from("applications").select("id, job_id, company, title, location, page_url, status, notes, source, created_at, updated_at")
    .eq("user_id", user.id).order("updated_at", { ascending: false });
  return Response.json({ applications: data, statuses: STATUSES });
});

/*
 POST { id, status?, notes? }                        -> update an application
 POST { action: "save", job: {title, company, location?, url, description?}, source? }   -> save a job (extension "Save job")
 POST { action: "save", jobId | feedJobId }          -> save a job from the feed / your jobs
*/
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const b = await req.json();

  if (b.id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.status !== undefined) {
      const status = ALIAS[b.status] || b.status;
      if (!(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "Bad status");
      patch.status = status;
    }
    if (b.notes !== undefined) patch.notes = String(b.notes).slice(0, 4000);
    await db.from("applications").update(patch).eq("id", b.id).eq("user_id", user.id);
    return Response.json({ ok: true });
  }

  if (b.action === "save") {
    let row: Record<string, unknown>;
    if (b.feedJobId || b.jobId) {
      const job = b.feedJobId ? await ensureUserJob(db, user.id, b.feedJobId)
        : (await db.from("jobs").select("*").eq("id", b.jobId).eq("user_id", user.id).single()).data;
      if (!job) throw new HttpError(404, "Job not found");
      row = { job_id: job.id, company: job.company, title: job.title, location: job.location, page_url: job.apply_url, source: b.feedJobId ? "feed" : "search" };
    } else {
      const j = b.job || {};
      if (!j.url && !j.title) throw new HttpError(400, "Nothing to save");
      let jobId: string | null = null;
      if (j.url && j.description) {
        const { data } = await db.from("jobs").upsert({
          user_id: user.id, external_id: `page:${String(j.url).split("?")[0].slice(0, 400)}`, title: j.title, company: j.company,
          location: j.location, remote: /remote/i.test(j.location || ""), apply_url: j.url, description: String(j.description).slice(0, 12000)
        }, { onConflict: "user_id,external_id" }).select("id").single();
        jobId = data?.id ?? null;
      }
      row = { job_id: jobId, company: j.company, title: j.title, location: j.location, page_url: j.url, source: b.source || "extension", hiring_team: j.hiringTeam || null };
    }
    const existing = row.page_url
      ? (await db.from("applications").select("id, status").eq("user_id", user.id).eq("page_url", row.page_url as string).limit(1).maybeSingle()).data
      : null;
    if (existing) return Response.json({ id: existing.id, status: existing.status, duplicate: true });
    const { data, error } = await db.from("applications").insert({ user_id: user.id, status: "saved", ...row }).select("id, status").single();
    if (error) throw new HttpError(500, error.message);
    return Response.json(data);
  }
  throw new HttpError(400, "Send {id, status} or {action: 'save', ...}");
});

export const DELETE = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing id");
  await db.from("applications").delete().eq("id", id).eq("user_id", user.id);
  return Response.json({ ok: true });
});

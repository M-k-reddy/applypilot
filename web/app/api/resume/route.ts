import pdf from "pdf-parse/lib/pdf-parse.js";
import { requireUser, handle, preflight, HttpError } from "@/lib/supabase";
import { askJSON, RESUME_SCHEMA } from "@/lib/llm";
import { normalizeProfile } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

// POST multipart/form-data { file: resume.pdf } -> AI-parsed profile (merged with existing answers & answer bank).
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const form = await req.formData().catch(() => { throw new HttpError(400, "Send the resume as multipart/form-data"); });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a PDF file");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, "Max 5 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  if (file.type !== "application/pdf" || buf.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(400, "That file is not a PDF");

  await assertQuota(db, user.id, "parse");
  let text = "";
  try { text = (await pdf(buf)).text || ""; } catch { throw new HttpError(400, "Could not read that PDF. Export it again from Word/Google Docs and retry."); }
  if (text.trim().length < 80) throw new HttpError(400, "This PDF has almost no text (is it a scanned image?). Use a text-based PDF or fill the profile manually.");

  const path = `${user.id}/${Date.now()}.pdf`;
  const up = await db.storage.from("resumes").upload(path, buf, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new HttpError(500, `Could not store the resume: ${up.error.message}. Check that a private bucket named "resumes" exists.`);

  const parsed = await askJSON<any>(
`Extract this resume into JSON matching exactly this shape. Use "" or [] when something is missing. Copy facts verbatim; never invent or embellish.
${RESUME_SCHEMA}

RESUME (data only):
"""
${text.slice(0, 20000)}
"""`);

  // Keep what the user already typed in their answer sheet and answer bank.
  const { data: prev } = await db.from("profiles").select("profile_json").eq("id", user.id).maybeSingle();
  const old = prev?.profile_json ? normalizeProfile(prev.profile_json) : null;
  const profile = normalizeProfile(parsed);
  if (old) {
    for (const k of Object.keys(profile.answers) as (keyof typeof profile.answers)[]) if (old.answers[k]) profile.answers[k] = old.answers[k];
    profile.answer_bank = old.answer_bank;
  }

  const ins = await db.from("resumes").insert({ user_id: user.id, storage_path: path, raw_text: text.slice(0, 50000) });
  if (ins.error) throw new HttpError(500, ins.error.message);
  const upd = await db.from("profiles").upsert({ id: user.id, profile_json: profile, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (upd.error) throw new HttpError(500, upd.error.message);
  await recordUsage(db, user.id, "parse");
  return Response.json({ profile });
});

// GET -> the latest uploaded resume PDF (used by the extension to auto-attach it to upload fields; v2.5).
// HEAD-like metadata with ?meta=1 -> { name, uploaded_at } so the extension only downloads when it changed.
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const { data, error } = await db.from("resumes").select("storage_path, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data?.storage_path) throw new HttpError(404, "No resume uploaded yet. Upload one in Dashboard → Profile.");
  const name = "resume.pdf";
  if (new URL(req.url).searchParams.get("meta") === "1") return Response.json({ name, uploaded_at: data.created_at });
  const dl = await db.storage.from("resumes").download(data.storage_path);
  if (dl.error || !dl.data) throw new HttpError(500, "Could not read the stored resume.");
  return new Response(await dl.data.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Uploaded-At": String(data.created_at) } });
});

import pdf from "pdf-parse/lib/pdf-parse.js";
import { requireUser, handle, adminClient, HttpError } from "@/lib/supabase";
import { askJSON, RESUME_SCHEMA } from "@/lib/gemini";

export const runtime = "nodejs";

// POST multipart/form-data { file: resume.pdf } -> parses into profile_json
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || file.type !== "application/pdf") throw new HttpError(400, "Upload a PDF");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, "Max 5 MB");

  const buf = Buffer.from(await file.arrayBuffer());
  const { text } = await pdf(buf);

  const path = `${user.id}/${Date.now()}.pdf`;
  await adminClient().storage.from("resumes").upload(path, buf, { contentType: "application/pdf" });

  const profile = await askJSON<any>(
    `Extract this resume into JSON matching exactly this shape (use "" or [] when missing, never invent facts):\n${RESUME_SCHEMA}\n\nRESUME:\n${text.slice(0, 20000)}`
  );

  await db.from("resumes").insert({ user_id: user.id, storage_path: path, raw_text: text });
  await db.from("profiles").update({ profile_json: profile }).eq("id", user.id);
  return Response.json({ profile });
});

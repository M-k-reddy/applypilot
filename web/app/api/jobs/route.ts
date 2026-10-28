import { requireUser, handle, HttpError } from "@/lib/supabase";
import { fetchJSearch, jsearchEnabled } from "@/lib/feeds/jsearch";

export const runtime = "nodejs";

// OPTIONAL paid-tier source. GET /api/jobs?q=AI intern&location=Hyderabad&remote=true&fresher=true
// Needs RAPIDAPI_KEY (JSearch). The free feed is /api/feed.
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  if (!jsearchEnabled()) throw new HttpError(400, "JSearch is optional and not configured. Use the free feed (/feed).");
  const u = new URL(req.url);
  const q = u.searchParams.get("q") || "software engineer fresher";
  const location = u.searchParams.get("location") || "India";
  const remote = u.searchParams.get("remote") === "true";
  const fresher = u.searchParams.get("fresher") !== "false";

  const found = await fetchJSearch(q, location, { remote, fresher });
  const rows = found.map((j) => ({
    user_id: user.id, external_id: j.external_id.replace(/^jsearch:/, ""), title: j.title, company: j.company,
    location: j.location, remote: j.remote, apply_url: j.apply_url, description: j.description
  }));
  if (rows.length) await db.from("jobs").upsert(rows, { onConflict: "user_id,external_id", ignoreDuplicates: true });
  const { data: jobs } = await db.from("jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
  return Response.json({ jobs });
});

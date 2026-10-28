import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllFeeds } from "./index";

/** Fetch all seed boards and upsert into the shared feed_jobs table (service-role client). */
export async function ingestFeeds(admin: SupabaseClient) {
  const started = Date.now();
  const run = await fetchAllFeeds();
  const now = new Date().toISOString();
  const rows = run.jobs.map((j) => ({
    external_id: j.external_id, source: j.source, title: j.title, company: j.company, location: j.location, remote: j.remote,
    apply_url: j.apply_url, description: j.description, posted_at: j.posted_at, department: j.department ?? null,
    employment_type: j.employment_type ?? null, experience_min: j.experience_min ?? null, experience_max: j.experience_max ?? null,
    fresher: !!j.fresher, skills: j.skills ?? [], last_seen_at: now
  }));
  let upserted = 0; const dbErrors: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("feed_jobs").upsert(rows.slice(i, i + 500), { onConflict: "external_id" });
    if (error) dbErrors.push(error.message); else upserted += Math.min(500, rows.length - i);
  }
  // postings not seen for 14 days are closed; drop them
  const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
  await admin.from("feed_jobs").delete().lt("last_seen_at", cutoff);
  return { fetched: run.jobs.length, upserted, sourceErrors: run.errors, dbErrors, perCompany: run.perCompany, ms: Date.now() - started };
}

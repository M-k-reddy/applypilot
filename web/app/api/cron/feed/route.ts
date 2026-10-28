import { handle, adminClient } from "@/lib/supabase";
import { requireCron } from "@/lib/cron";
import { ingestFeeds } from "@/lib/feeds/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (see vercel.json): daily refresh of the shared feed_jobs table.
export const GET = handle(async (req) => {
  requireCron(req);
  const result = await ingestFeeds(adminClient());
  return Response.json(result);
});

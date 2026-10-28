import { handle, adminClient } from "@/lib/supabase";
import { requireCron } from "@/lib/cron";
import { FEED_COLS } from "@/lib/data";
import { filterJobs, Job } from "@/lib/feeds";
import { quickMatch } from "@/lib/match";
import { emailEnabled, sendEmail } from "@/lib/email";
import { esc } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 Vercel Cron (after the feed refresh): for each active alert, find feed jobs first seen since the alert last ran,
 store an in-app notification, and email a digest when RESEND_API_KEY is set and the alert has email on.
*/
export const GET = handle(async (req) => {
  requireCron(req);
  const admin = adminClient();
  const { data: alerts } = await admin.from("alerts").select("*").eq("active", true).limit(2000);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  let notified = 0, emailed = 0;
  const profileCache = new Map<string, { email?: string; profile?: any }>();

  for (const a of alerts || []) {
    const since = a.last_run_at || new Date(Date.now() - 86400_000).toISOString();
    const { data: rows } = await admin.from("feed_jobs").select(FEED_COLS).gt("first_seen_at", since).limit(3000);
    const hits = filterJobs((rows || []) as unknown as (Job & { id: string })[], { keywords: a.keywords, location: a.location, remote: a.remote, fresher: a.fresher }) as (Job & { id: string })[];
    await admin.from("alerts").update({ last_run_at: new Date().toISOString() }).eq("id", a.id);
    if (!hits.length) continue;

    if (!profileCache.has(a.user_id)) {
      const { data: p } = await admin.from("profiles").select("email, profile_json").eq("id", a.user_id).single();
      profileCache.set(a.user_id, { email: p?.email, profile: p?.profile_json });
    }
    const { email, profile } = profileCache.get(a.user_id)!;
    const top = hits.map((j) => ({ ...j, score: profile ? quickMatch(profile, j).score : null }))
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 15);

    await admin.from("notifications").insert({
      user_id: a.user_id, kind: "job_alert", title: `${hits.length} new job${hits.length > 1 ? "s" : ""} for "${a.keywords}"`,
      body: top.slice(0, 5).map((j) => `${j.title} · ${j.company}`).join("\n"),
      data: { alert_id: a.id, jobs: top.map((j) => ({ id: j.id, title: j.title, company: j.company, location: j.location, apply_url: j.apply_url, score: j.score })) }
    });
    notified++;

    if (emailEnabled() && a.email && email) {
      const items = top.map((j) => `<li><a href="${esc(j.apply_url)}">${esc(j.title)}</a> · ${esc(j.company)} · ${esc(j.remote ? "Remote" : j.location)}${j.score !== null ? ` · match ${j.score}/100` : ""}</li>`).join("");
      const ok = await sendEmail(email, `ApplyPilot: ${hits.length} new jobs for "${a.keywords}"`,
        `<p>New postings matching your alert <b>${esc(a.keywords)}</b>${a.location ? ` in ${esc(a.location)}` : ""}:</p><ul>${items}</ul>
         ${appUrl ? `<p><a href="${esc(appUrl)}/feed">Open your feed</a> · <a href="${esc(appUrl)}/feed#alerts">Manage alerts</a></p>` : ""}
         <p style="color:#888;font-size:12px">You get this because you created a job alert in ApplyPilot. Turn email off for the alert to stop.</p>`);
      if (ok) emailed++;
    }
  }
  return Response.json({ alerts: alerts?.length ?? 0, notified, emailed, email: emailEnabled() });
});

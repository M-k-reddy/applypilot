import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { discoverJobs, targetFamilies, titleInFamilies, type Discovered } from "@/lib/discover";
import { atsScore } from "@/lib/ats";
import { profileText } from "@/lib/profile";
import { getPlan, freeLimits, usageThisMonth } from "@/lib/quota";
import { requireProfile, str } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

const IST = 330 * 60_000;
const istDayStart = () => { const n = new Date(Date.now() + IST); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - IST).toISOString(); };
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const urlKey = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/(apply)?\/?$/, "")}?${[...x.searchParams.entries()].filter(([k]) => /^(for|token|gh_jid|id|jobid|job_id)$/i.test(k)).map(([k, v]) => `${k}=${v}`).sort().join("&")}`.toLowerCase(); } catch { return u.toLowerCase(); } };

// POST /api/auto/discover  (extension Auto mode; API key or dashboard JWT)
// Body (all optional): { keywords: "react, frontend", location: "Hyderabad, Remote", remote: true, minScore: 30, remaining: 20 }
//   remaining = submissions left under today's Auto mode cap. Discovery adds at most 2× that (max 40) per call.
// Finds fresh entry-level jobs (Greenhouse + Lever boards first, aggregators second), drops ones already in the
// tracker, scores them with the deterministic ATS keyword scorer (no AI quota), and adds the ones >= minScore to the
// tracker as "saved" with source "auto". Returns them in the extension's queue shape.
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const b = await readJSON<any>(req).catch(() => ({}));
  const profile = await requireProfile(db, user.id);

  const kwRaw = Array.isArray(b.keywords) ? b.keywords.join(",") : str(b.keywords, 300);
  const keywords = kwRaw.split(/[,\n]/).map((k: string) => k.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const location = str(b.location, 200) || profile.answers.preferred_locations || profile.location || "India";
  const remote = b.remote === undefined ? true : !!b.remote;
  const minScore = Math.max(0, Math.min(100, Math.round(Number(b.minScore ?? 30)) || 0));
  const remaining = Math.max(1, Math.min(200, Math.floor(Number(b.remaining) || 20)));
  let target = Math.min(40, remaining * 2);

  // Plan quotas: each auto-applied job uses one autofill. Free users get no more queued than they can still fill,
  // and at most FREE_AUTO_DISCOVER_DAILY discovered jobs per IST day. Pro is bounded only by the 2× cap rule.
  const plan = await getPlan(db, user.id);
  if (plan === "free") {
    const left = freeLimits().autofill - (await usageThisMonth(db, user.id)).autofill;
    if (left <= 0) throw new HttpError(402, `You have used all ${freeLimits().autofill} free autofills this month, so Auto mode cannot apply to more jobs until the 1st (IST).`);
    const dailyMax = Number(process.env.FREE_AUTO_DISCOVER_DAILY) || 40;
    const { count } = await db.from("applications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("source", "auto").gte("created_at", istDayStart());
    const today = count ?? 0;
    if (today >= dailyMax) throw new HttpError(429, `Auto mode already found ${today} jobs for you today (free plan limit ${dailyMax}). It resets at midnight IST.`);
    target = Math.min(target, left * 2, dailyMax - today);
  }

  // Aggregator query from the profile: headline or most recent title, plus top skills.
  const role = profile.headline.split(/[|,•·-]/)[0].trim() || profile.experience[0]?.title || "";
  const search = (keywords.slice(0, 3).join(" ") || [role, ...profile.skills.slice(0, role ? 1 : 2)].filter(Boolean).join(" ")).slice(0, 100);

  const found = await discoverJobs({ keywords, search, location, remote });
  // Keep titles in the candidate's own role family (from headline, past titles and skills).
  const families = targetFamilies([profile.headline, ...profile.experience.map((e) => e.title)].join(" "), profile.skills);

  // Dedupe against everything already in this user's jobs + tracker.
  const [{ data: jobs }, { data: apps }] = await Promise.all([
    db.from("jobs").select("external_id, apply_url, company, title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(3000),
    db.from("applications").select("company, title, page_url").eq("user_id", user.id).order("created_at", { ascending: false }).limit(3000)
  ]);
  const seen = new Set<string>();
  for (const j of jobs || []) { if (j.external_id) seen.add(`id:${j.external_id}`); if (j.apply_url) seen.add(`u:${urlKey(j.apply_url)}`); if (j.title) seen.add(`ct:${normKey(`${j.company}|${j.title}`)}`); }
  for (const a of apps || []) { if (a.page_url) seen.add(`u:${urlKey(a.page_url)}`); if (a.title) seen.add(`ct:${normKey(`${a.company}|${a.title}`)}`); }

  const resume = profileText(profile);
  const scored: { j: Discovered; score: number; missing: string[]; tier: number }[] = [];
  let considered = 0, belowScore = 0, dupes = 0, offRole = 0;
  for (const [tier, list] of [[0, found.primary], [1, found.secondary]] as const) {
    for (const j of list) {
      considered++;
      if (!titleInFamilies(j.title, families)) { offRole++; continue; }
      const keys = [`id:${j.external_id}`, `u:${urlKey(j.apply_url)}`, `ct:${normKey(`${j.company}|${j.title}`)}`];
      if (keys.some((k) => seen.has(k))) { dupes++; continue; }
      keys.forEach((k) => seen.add(k));
      const ats = atsScore(j.description || j.title, resume);
      if (ats.score < minScore) { belowScore++; continue; }
      scored.push({ j, score: ats.score, missing: ats.missing.slice(0, 15), tier });
    }
  }
  scored.sort((a, b) => a.tier - b.tier || b.score - a.score);
  const picked = scored.slice(0, Math.max(0, target));

  const queue: { id: string; job_id: string; company: string; title: string; url: string; score: number; source: string }[] = [];
  if (picked.length) {
    const now = new Date().toISOString();
    const rows = picked.map(({ j, score, missing }) => ({
      user_id: user.id, external_id: j.external_id.slice(0, 300), source: j.source, title: j.title, company: j.company,
      apply_url: j.apply_url, description: j.description.slice(0, 12000), location: j.location, remote: j.remote, salary: j.salary || "",
      posted_at: j.posted_at && !Number.isNaN(Date.parse(j.posted_at)) ? new Date(j.posted_at).toISOString() : null,
      ats_score: score, missing_keywords: missing
    }));
    const { data: ins, error } = await db.from("jobs").upsert(rows, { onConflict: "user_id,external_id" }).select("id, external_id");
    if (error) throw new HttpError(500, error.message);
    const idOf = new Map((ins || []).map((r: any) => [r.external_id, r.id]));
    const appRows = picked.filter(({ j }) => idOf.get(j.external_id)).map(({ j, score }) => ({
      user_id: user.id, job_id: idOf.get(j.external_id), page_key: `job:${idOf.get(j.external_id)}`, page_url: j.apply_url,
      company: j.company, title: j.title, status: "saved", source: "auto", updated_at: now,
      notes: `Found by Auto mode (${j.source}${j.ats_board && j.ats_board !== j.source ? `: ${j.ats_board}` : ""}). ATS keyword match ${score}%.`
    }));
    const { data: apIns, error: apErr } = await db.from("applications").upsert(appRows, { onConflict: "user_id,page_key", ignoreDuplicates: true }).select("id, job_id");
    if (apErr) throw new HttpError(500, apErr.message);
    const appOf = new Map((apIns || []).map((r: any) => [r.job_id, r.id]));
    for (const { j, score } of picked) {
      const jobId = idOf.get(j.external_id); const appId = jobId && appOf.get(jobId);
      if (appId) queue.push({ id: appId, job_id: jobId, company: j.company, title: j.title, url: j.apply_url, score, source: j.source });
    }
  }

  return Response.json({
    queue, count: queue.length, target, minScore, location, keywords, plan,
    stats: { considered, offRole, duplicates: dupes, belowScore, eligible: scored.length }, families,
    sources: found.sources
  });
});

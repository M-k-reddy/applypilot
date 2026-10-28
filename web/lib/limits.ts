import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";

/**
 * Free-plan monthly caps, enforced server-side. Pro is unlimited.
 * Override any cap with an env var, e.g. FREE_LIMIT_ATS=10. FREE_MONTHLY_LIMIT still sets autofill.
 */
export type Feature = "autofill" | "ats" | "ats_fix" | "tailor" | "match" | "outreach" | "find_hr";

const DEFAULTS: Record<Feature, number> = { autofill: 5, ats: 5, ats_fix: 10, tailor: 2, match: 20, outreach: 5, find_hr: 5 };
const LABEL: Record<Feature, string> = {
  autofill: "autofills", ats: "ATS checks", ats_fix: "AI bullet fixes", tailor: "tailored resumes",
  match: "AI match reports", outreach: "outreach drafts", find_hr: "HR lookups"
};

export function freeLimit(f: Feature): number {
  const env = f === "autofill" ? process.env.FREE_MONTHLY_LIMIT : process.env[`FREE_LIMIT_${f.toUpperCase()}`];
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS[f];
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

export async function getPlan(db: SupabaseClient, userId: string): Promise<string> {
  const { data } = await db.from("profiles").select("plan").eq("id", userId).single();
  return data?.plan || "free";
}

/** Throws 402 when a free user has used up this month's quota for the feature. */
export async function checkQuota(db: SupabaseClient, userId: string, f: Feature, plan?: string) {
  plan = plan ?? (await getPlan(db, userId));
  if (plan === "pro") return { plan, used: 0, limit: Infinity };
  const { count } = await db.from("usage_events").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("feature", f).gte("created_at", monthStart());
  const used = count ?? 0, limit = freeLimit(f);
  if (used >= limit) throw new HttpError(402, `Free plan limit of ${limit} ${LABEL[f]} this month reached. Upgrade to Pro for unlimited.`);
  return { plan, used, limit };
}

/** Record one use after the work succeeded (so failures don't burn quota). */
export async function recordUsage(db: SupabaseClient, userId: string, f: Feature, meta: Record<string, unknown> = {}) {
  await db.from("usage_events").insert({ user_id: userId, feature: f, meta });
}

export async function usageSummary(db: SupabaseClient, userId: string) {
  const plan = await getPlan(db, userId);
  const { data } = await db.from("usage_events").select("feature").eq("user_id", userId).gte("created_at", monthStart());
  const counts: Record<string, number> = {};
  (data || []).forEach((r: any) => (counts[r.feature] = (counts[r.feature] || 0) + 1));
  const features = (Object.keys(DEFAULTS) as Feature[]).map((f) => ({
    feature: f, label: LABEL[f], used: counts[f] || 0, limit: plan === "pro" ? null : freeLimit(f)
  }));
  return { plan, features };
}

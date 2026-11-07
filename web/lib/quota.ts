import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";

export type UsageKind = "analysis" | "tailor" | "cover_letter" | "autofill" | "parse";
export const KINDS: UsageKind[] = ["analysis", "tailor", "cover_letter", "autofill", "parse"];

export const KIND_LABEL: Record<UsageKind, string> = {
  analysis: "Fit analyses & interview prep", tailor: "Resume tailors", cover_letter: "Cover letters", autofill: "Autofills", parse: "Resume parses"
};

const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export function freeLimits(): Record<UsageKind, number> {
  return {
    analysis: n(process.env.FREE_ANALYSES, 30),
    tailor: n(process.env.FREE_TAILORS, 15),
    cover_letter: n(process.env.FREE_COVER_LETTERS, 10),
    autofill: n(process.env.FREE_AUTOFILLS, 50),
    parse: n(process.env.FREE_PARSES, 10)
  };
}

/** Start of the current calendar month in India (IST, UTC+05:30), as a UTC ISO string. */
export function istMonthStart(now = new Date()): string {
  const IST = 330 * 60_000;
  const ist = new Date(now.getTime() + IST);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST).toISOString();
}

/** Admins (ADMIN_EMAILS, comma-separated; owner included by default) get Pro: unlimited usage. */
const OWNER = "challamanikethanreddy@gmail.com";
export function adminEmails(): string[] {
  return [OWNER, ...(process.env.ADMIN_EMAILS || "").split(",")].map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export async function isAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const email = data?.user?.email?.toLowerCase();
    return !!email && adminEmails().includes(email);
  } catch { return false; }
}

export async function getPlan(db: SupabaseClient, userId: string): Promise<"free" | "pro"> {
  if (await isAdmin(db, userId)) return "pro";
  const { data } = await db.from("subscriptions").select("plan, status, current_period_end").eq("user_id", userId).maybeSingle();
  if (!data || data.plan !== "pro") return "free";
  if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now() - 3 * 86400_000) return "free";
  return "pro";
}

/** Highest auto-apply daily cap a plan may set (FREE_AUTO_DAILY_MAX / PRO_AUTO_DAILY_MAX env, defaults 20 / 200). */
export function autoDailyMax(plan: "free" | "pro"): number {
  return plan === "pro" ? n(process.env.PRO_AUTO_DAILY_MAX, 200) : n(process.env.FREE_AUTO_DAILY_MAX, 20);
}

export async function usageThisMonth(db: SupabaseClient, userId: string): Promise<Record<UsageKind, number>> {
  const { data, error } = await db.from("usage_events").select("kind").eq("user_id", userId).gte("created_at", istMonthStart()).limit(5000);
  if (error) throw new HttpError(500, error.message);
  const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<UsageKind, number>;
  for (const r of data || []) if ((KINDS as string[]).includes(r.kind)) out[r.kind as UsageKind]++;
  return out;
}

/** Throws 402 when a free user has used up this month's quota for `kind`. Pro is unlimited. */
export async function assertQuota(db: SupabaseClient, userId: string, kind: UsageKind) {
  if ((await getPlan(db, userId)) === "pro") return;
  const limit = freeLimits()[kind];
  const { count, error } = await db.from("usage_events").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("kind", kind).gte("created_at", istMonthStart());
  if (error) throw new HttpError(500, error.message);
  if ((count ?? 0) >= limit)
    throw new HttpError(402, `You have used all ${limit} free ${KIND_LABEL[kind].toLowerCase()} this month. It resets on the 1st (IST)${billingEnabled() ? ", or upgrade to Pro for unlimited" : ""}.`);
}

/** Record one unit of usage. Only the server (service role) can write usage_events. */
export async function recordUsage(db: SupabaseClient, userId: string, kind: UsageKind) {
  const { error } = await db.from("usage_events").insert({ user_id: userId, kind });
  if (error) console.error("usage insert failed", error.message);
}

export const billingEnabled = () =>
  !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_PLAN_ID && process.env.RAZORPAY_WEBHOOK_SECRET);

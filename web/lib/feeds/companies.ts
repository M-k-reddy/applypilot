import { CompanySeed } from "./types";

/**
 * EDITABLE seed list of company job boards for the free feed.
 * Add a company by finding its board token in its careers URL:
 *   Greenhouse     boards.greenhouse.io/{token}   or job-boards.greenhouse.io/{token}
 *   Lever          jobs.lever.co/{token}
 *   Ashby          jobs.ashbyhq.com/{token}
 *   Workable       apply.workable.com/{token}
 *   SmartRecruiters jobs.smartrecruiters.com/{CompanyId}   (case-sensitive)
 * `verified: true` = the endpoint returned jobs when this list was written (Oct 2026). Boards move; dead ones are skipped and logged.
 * You can also override the whole list at runtime with FEED_COMPANIES_JSON (same shape, JSON array).
 */
export const COMPANIES: CompanySeed[] = [
  // ---- India-based / big India hiring ----
  { ats: "greenhouse", token: "groww", name: "Groww", region: "india", verified: true },
  { ats: "greenhouse", token: "razorpaysoftwareprivatelimited", name: "Razorpay", region: "india", verified: true },
  { ats: "greenhouse", token: "druva", name: "Druva", region: "india", verified: true },
  { ats: "greenhouse", token: "hackerrank", name: "HackerRank", region: "india", verified: true },
  { ats: "lever", token: "cred", name: "CRED", region: "india", verified: true },
  { ats: "lever", token: "meesho", name: "Meesho", region: "india", verified: true },
  { ats: "lever", token: "zeta", name: "Zeta", region: "india", verified: true },
  { ats: "lever", token: "paytm", name: "Paytm", region: "india", verified: true },
  { ats: "lever", token: "fampay", name: "FamPay", region: "india", verified: true },
  { ats: "lever", token: "mindtickle", name: "Mindtickle", region: "india", verified: true },
  { ats: "ashby", token: "sarvam", name: "Sarvam AI", region: "india", verified: true },
  { ats: "smartrecruiters", token: "Swiggy", name: "Swiggy", region: "india", verified: true },
  { ats: "smartrecruiters", token: "Freshworks", name: "Freshworks", region: "india", verified: true },
  // ---- Global companies with India offices ----
  { ats: "greenhouse", token: "databricks", name: "Databricks", region: "global", verified: true },
  { ats: "greenhouse", token: "rubrik", name: "Rubrik", region: "global", verified: true },
  { ats: "greenhouse", token: "zscaler", name: "Zscaler", region: "global", verified: true },
  { ats: "greenhouse", token: "mongodb", name: "MongoDB", region: "global", verified: true },
  { ats: "greenhouse", token: "stripe", name: "Stripe", region: "global", verified: true },
  { ats: "greenhouse", token: "samsara", name: "Samsara", region: "global", verified: true },
  { ats: "greenhouse", token: "intercom", name: "Intercom", region: "global", verified: true },
  { ats: "lever", token: "palantir", name: "Palantir", region: "global", verified: true },
  { ats: "smartrecruiters", token: "ServiceNow", name: "ServiceNow", region: "global", verified: true },
  { ats: "smartrecruiters", token: "Experian", name: "Experian", region: "global", verified: true },
  { ats: "smartrecruiters", token: "BoschGroup", name: "Bosch", region: "global", verified: true },
  // ---- Remote-friendly ----
  { ats: "greenhouse", token: "gitlab", name: "GitLab", region: "remote", verified: true },
  { ats: "greenhouse", token: "elastic", name: "Elastic", region: "remote", verified: true },
  { ats: "greenhouse", token: "cloudflare", name: "Cloudflare", region: "remote", verified: true },
  { ats: "greenhouse", token: "coinbase", name: "Coinbase", region: "remote", verified: true },
  { ats: "ashby", token: "supabase", name: "Supabase", region: "remote", verified: true },
  { ats: "ashby", token: "posthog", name: "PostHog", region: "remote", verified: true },
  { ats: "ashby", token: "linear", name: "Linear", region: "remote", verified: true },
  { ats: "ashby", token: "replit", name: "Replit", region: "remote", verified: true },
  { ats: "ashby", token: "cohere", name: "Cohere", region: "remote", verified: true },
  { ats: "ashby", token: "notion", name: "Notion", region: "global", verified: true },
  { ats: "ashby", token: "openai", name: "OpenAI", region: "global", verified: true },
  // ---- Workable (rate-limited from our test IP, so unverified; check the slug before relying on it) ----
  { ats: "workable", token: "hasura", name: "Hasura", region: "india", verified: false },
  { ats: "workable", token: "clevertap", name: "CleverTap", region: "india", verified: false }
];

export function loadCompanies(): CompanySeed[] {
  const raw = process.env.FEED_COMPANIES_JSON;
  if (raw) { try { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr; } catch { /* fall through */ } }
  return COMPANIES;
}

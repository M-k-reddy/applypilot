import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";
import { normalizeProfile, Profile } from "./profile";
import { isFresherFriendly } from "./jobs";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(v: unknown, max: number, field = "value"): string {
  if (v == null) return "";
  if (typeof v !== "string" && typeof v !== "number") throw new HttpError(400, `${field} must be text`);
  return String(v).replace(/\u0000/g, "").trim().slice(0, max);
}
export function uuid(v: unknown, field = "id"): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, `${field} is missing or invalid`);
  return v;
}
export function httpUrl(v: unknown, field = "url"): string {
  const s = str(v, 2000, field);
  if (!s) return "";
  try { const u = new URL(s); if (u.protocol !== "http:" && u.protocol !== "https:") throw 0; return u.toString(); }
  catch { throw new HttpError(400, `${field} must be an http(s) URL`); }
}

export async function loadProfile(db: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await db.from("profiles").select("profile_json").eq("id", userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data?.profile_json ? normalizeProfile(data.profile_json) : null;
}

export async function requireProfile(db: SupabaseClient, userId: string): Promise<Profile> {
  const p = await loadProfile(db, userId);
  if (!p || (!p.full_name && !p.skills.length && !p.experience.length && !p.projects.length))
    throw new HttpError(400, "Add your profile first: upload your resume in Dashboard → Profile.");
  return p;
}

export async function getJob(db: SupabaseClient, userId: string, id: unknown) {
  const { data, error } = await db.from("jobs").select("*").eq("id", uuid(id, "jobId")).eq("user_id", userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Job not found. Save it first.");
  return data;
}

/** Validate a job coming from the dashboard search or the extension, and upsert it for this user. */
export async function saveJob(db: SupabaseClient, userId: string, j: any) {
  if (!j || typeof j !== "object") throw new HttpError(400, "job is required");
  const title = str(j.title, 200, "title"), company = str(j.company, 160, "company") || "Unknown company";
  if (!title) throw new HttpError(400, "Job title is required");
  const apply_url = httpUrl(j.apply_url || j.url, "apply_url");
  const description = str(j.description, 12000, "description");
  const source = ["adzuna", "remotive", "arbeitnow", "jsearch", "extension"].includes(j.source) ? j.source : "extension";
  const external_id = str(j.external_id, 300) || `url:${(apply_url || `${title}|${company}`).replace(/[?#].*$/, "").toLowerCase()}`;
  const row = {
    user_id: userId, external_id, source, title, company, apply_url, description,
    location: str(j.location, 160), remote: !!j.remote, salary: str(j.salary, 80),
    posted_at: j.posted_at && !Number.isNaN(Date.parse(j.posted_at)) ? new Date(j.posted_at).toISOString() : null
  };
  const { data, error } = await db.from("jobs").upsert(row, { onConflict: "user_id,external_id" }).select("*").single();
  if (error) throw new HttpError(500, error.message);
  return { ...data, fresher: isFresherFriendly(title, description) };
}

/** Normalised key so a multi-step form (same job, same page) maps to one application row. */
export function pageKey(url: string, jobId?: string | null): string {
  if (jobId) return `job:${jobId}`;
  try {
    const u = new URL(url);
    // Keep job-identifying query params (e.g. ?gh_jid=, ?jobId=, ?currentJobId=) but drop step/tracking params.
    const keep = ["gh_jid", "jobid", "job_id", "currentjobid", "jk", "id", "jobreqid"];
    const q = [...u.searchParams.entries()].filter(([k]) => keep.includes(k.toLowerCase())).map(([k, v]) => `${k.toLowerCase()}=${v}`).sort().join("&");
    const path = u.pathname.replace(/\/(apply|application|review|step-?\d+|page-?\d+|questions|contact-info|resume|voluntary-disclosures|my-information|my-experience|self-identify|review-submit)\/?$/i, "").replace(/\/$/, "");
    return `url:${u.host.toLowerCase()}${path.toLowerCase()}${q ? "?" + q : ""}`.slice(0, 500);
  } catch { return `url:${url.slice(0, 500)}`; }
}

export const words = (t: string) => (t.trim().match(/\S+/g) || []).length;

/** Trim text to at most `max` words, ending on a sentence boundary when possible. */
export function capWords(t: string, max: number): string {
  if (words(t) <= max) return t.trim();
  const tokens = t.trim().split(/(\s+)/); let n = 0, out = "";
  for (const tok of tokens) { if (/\S/.test(tok)) { if (n >= max) break; n++; } out += tok; }
  const cut = out.lastIndexOf(".");
  return (cut > out.length * 0.6 ? out.slice(0, cut + 1) : out.trim() + "…").trim();
}

/** Numbers (e.g. 40%, 3x, 1200) in `text` that do not appear anywhere in `source`. Used to block invented metrics. */
export function inventedNumbers(text: string, source: string): string[] {
  const nums = text.match(/\d[\d,.]*\s*(%|x|k|\+|lpa|cr|lakh)?/gi) || [];
  const src = source.replace(/,/g, "");
  return nums.map((n) => n.trim()).filter((n) => !src.includes(n.replace(/,/g, "").replace(/\s*(%|x|k|\+|lpa|cr|lakh)$/i, "")));
}

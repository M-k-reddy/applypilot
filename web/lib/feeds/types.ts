export type AtsSource = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "jsearch";

/** One normalized job, whatever board it came from. */
export type Job = {
  source: AtsSource;
  external_id: string;          // `${source}:${company token}:${id}`, stable across refreshes
  title: string;
  company: string;
  location: string;
  remote: boolean;
  apply_url: string;
  description: string;          // plain text, truncated
  posted_at: string | null;     // ISO
  department?: string;
  employment_type?: string;
  experience_min?: number | null;
  experience_max?: number | null;
  fresher?: boolean;
  skills?: string[];            // dictionary skills found in title+description (precomputed at ingest)
};

export type CompanySeed = { ats: Exclude<AtsSource, "jsearch">; token: string; name: string; region?: "india" | "remote" | "global"; verified?: boolean };

export const MAX_DESC = 8000;
export const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(typeof v === "number" ? v : String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
};

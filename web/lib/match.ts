import { profileToText } from "./ats";
import { candidateYears, experienceFit, parseExperience } from "./experience";
import { extractSkills, skillGap } from "./skills";

export type QuickMatch = {
  score: number;                       // 0-100
  matched_skills: string[];
  missing_skills: string[];
  experience: { required_min: number | null; required_max: number | null; candidate_years: number; fit: string; note: string };
};

/**
 * Deterministic, free match score: skill coverage (70%) + experience fit (30%).
 * Used on every job card. The AI report in /api/match blends this with an LLM judgement.
 */
export type MatchableJob = {
  title: string; description?: string | null;
  skills?: string[] | null; experience_min?: number | null; experience_max?: number | null; fresher?: boolean | null;
};

export function quickMatch(profile: any, job: MatchableJob): QuickMatch {
  const candText = [profileToText(profile), (profile?.skills || []).join(", ")].join("\n");
  const jd = `${job.title}\n${job.description || ""}`;
  let gap = skillGap(candText, jd);
  if (!job.description && job.skills?.length) {
    const have = new Set(extractSkills(candText));
    gap = { required: job.skills, matched: job.skills.filter((s) => have.has(s)), missing: job.skills.filter((s) => !have.has(s)) };
  }
  let exp = parseExperience(job.title, job.description || "");
  if (!job.description && job.experience_min !== undefined)
    exp = { ...exp, min: job.experience_min ?? null, max: job.experience_max ?? null, fresher: exp.fresher || !!job.fresher };
  const years = candidateYears(profile);
  const ef = experienceFit(exp, years);
  let skillScore: number;
  if (gap.required.length) skillScore = (gap.matched.length / gap.required.length) * 100;
  else {
    // JD names no dictionary skills: fall back to title overlap with the candidate's skills/headline
    const titleSkills = extractSkills(job.title);
    skillScore = titleSkills.length ? (titleSkills.filter((s) => gap.matched.includes(s) || candText.includes(s)).length / titleSkills.length) * 100 : 50;
  }
  const score = Math.round(skillScore * 0.7 + ef.score * 0.3);
  return {
    score: Math.max(0, Math.min(100, score)),
    matched_skills: gap.matched, missing_skills: gap.missing,
    experience: { required_min: exp.min, required_max: exp.max, candidate_years: years, fit: ef.fit, note: ef.note }
  };
}

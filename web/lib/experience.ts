/**
 * Experience detection for job descriptions and candidate profiles.
 * Used by the feed filter (fresher mode) and the match score.
 */
export type ExpInfo = { min: number | null; max: number | null; fresher: boolean; senior: boolean; evidence: string };

const FRESHER_RE = /\b(fresher|freshers|entry[ -]level|new grad(uate)?s?|graduate (program|engineer|trainee)|campus (hire|hiring|recruit)|recent graduates?|early[ -]career|no (prior )?experience (required|needed)|0\s*(-|–|to)\s*[12]\s*(\+\s*)?(years?|yrs?)|intern(ship)?s?\b|trainee|apprentice|junior|associate (software|engineer|developer|analyst)|batch (of )?20(2[4-9]))/i;
const SENIOR_TITLE_RE = /\b(senior|sr\.?|lead|principal|staff|manager|mgr|mgmt|dir|director|head of|vp|vice president|architect|chief|distinguished|expert|specialist ii|engineer (ii|iii|iv)|sde ?(ii|iii|2|3)|level [3-6])\b/i;

/** Parse "3+ years", "2-4 yrs", "minimum of 5 years", "0-1 years" from text. */
export function parseExperience(title: string, description: string): ExpInfo {
  const text = `${title}\n${description || ""}`;
  const ranges: { min: number; max: number | null; ev: string }[] = [];
  const re = /(?:(?:minimum|min\.?|at least|over|more than)\s+(?:of\s+)?)?(\d{1,2})(?:\.\d)?\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,4}?\s+(?:experience|exp\b|industry|professional|hands-on|working)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
    if (a > 30 || (b !== null && b > 30)) continue;
    ranges.push({ min: a, max: b, ev: m[0].slice(0, 80) });
  }
  // "Experience: 0-2 years", "(0-1 years)", "experience of 1 to 3 yrs"
  const re2 = /(?:experience[^.\n]{0,25}?|\()\s*(\d{1,2})\s*(?:\+|(?:-|–|to)\s*(\d{1,2}))?\s*(?:years?|yrs?)/gi;
  while ((m = re2.exec(text))) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
    if (a <= 30 && (b === null || b <= 30)) ranges.push({ min: a, max: b, ev: m[0].slice(0, 80) });
  }
  // the requirement is usually the smallest stated minimum (avoid "company with 20 years of experience")
  ranges.sort((x, y) => x.min - y.min);
  const r = ranges[0];
  const fresher = FRESHER_RE.test(text) && !(r && r.min >= 3);
  // a senior title wins over fresher words in the body ("mentor junior engineers"), unless the title itself says intern/graduate
  const senior = SENIOR_TITLE_RE.test(title) && !FRESHER_RE.test(title);
  return { min: r?.min ?? null, max: r?.max ?? null, fresher: fresher && !senior, senior, evidence: r?.ev ?? "" };
}

/** Is this job suitable for someone with at most `maxYears` of experience? */
export function fitsExperience(info: ExpInfo, maxYears = 2): boolean {
  if (info.senior) return false;
  if (info.min !== null && info.min > maxYears) return false;
  return true;
}

/** Candidate years from the parsed profile (falls back to counting internships). */
export function candidateYears(profile: any): number {
  const y = Number(profile?.total_experience_years);
  if (Number.isFinite(y) && y > 0) return y;
  return 0;
}

export function experienceFit(info: ExpInfo, years: number): { fit: "good" | "stretch" | "under" | "unknown"; note: string; score: number } {
  if (info.min === null) {
    if (info.senior) return { fit: "under", note: "Senior-level title; likely needs several years of experience.", score: 25 };
    if (info.fresher) return { fit: "good", note: "Posting is open to freshers / entry level.", score: 100 };
    return { fit: "unknown", note: "No experience requirement stated.", score: 70 };
  }
  const gap = info.min - years;
  if (gap <= 0) return { fit: "good", note: `Asks for ${info.min}${info.max ? "–" + info.max : "+"} years; you meet it.`, score: 100 };
  if (gap <= 1) return { fit: "stretch", note: `Asks for ${info.min}+ years; you are about ${gap} year short. Worth applying with strong projects.`, score: 65 };
  return { fit: "under", note: `Asks for ${info.min}+ years; that is ${gap} years more than you have.`, score: Math.max(5, 40 - gap * 10) };
}

// Deterministic ATS keyword-match scoring. No AI, no network. Runs in the browser and on the server.
// Score = weighted share of the job description's keywords that appear in the resume text.

const SKILLS = [
  // languages
  "python", "java", "javascript", "typescript", "c++", "c#", "c", "golang", "rust", "kotlin", "swift", "php", "ruby", "scala", "r", "matlab", "dart", "bash", "shell scripting",
  // web
  "html", "css", "react", "react native", "next.js", "angular", "vue", "node.js", "express", "django", "flask", "fastapi", "spring", "spring boot", "graphql", "rest api", "rest", "tailwind", "redux", "jquery", "bootstrap", "flutter", "android", "ios",
  // data / ml
  "sql", "mysql", "postgresql", "mongodb", "redis", "nosql", "firebase", "supabase", "oracle", "excel", "power bi", "tableau", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "keras", "machine learning", "deep learning", "nlp", "computer vision", "llm", "generative ai", "data analysis", "data analytics", "data science", "data visualization", "statistics", "etl", "spark", "hadoop", "airflow", "big data", "opencv", "langchain", "prompt engineering",
  // cloud / devops
  "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "terraform", "jenkins", "ci/cd", "linux", "git", "github", "gitlab", "devops", "microservices", "serverless", "networking", "cybersecurity", "jira",
  // cs fundamentals
  "data structures", "algorithms", "oop", "object oriented programming", "dbms", "operating systems", "system design", "unit testing", "testing", "selenium", "automation", "api", "agile", "scrum",
  // business / soft
  "communication", "teamwork", "problem solving", "leadership", "analytical", "presentation", "stakeholder management", "customer service", "sales", "marketing", "digital marketing", "seo", "content writing", "social media", "figma", "ui/ux", "ui", "ux", "photoshop", "accounting", "tally", "gst", "finance", "recruitment", "operations", "project management", "english", "ms office", "powerpoint"
];

const SYNONYMS: Record<string, string> = {
  js: "javascript", ts: "typescript", nodejs: "node.js", node: "node.js", reactjs: "react", "react.js": "react", nextjs: "next.js",
  postgres: "postgresql", mongo: "mongodb", k8s: "kubernetes", ml: "machine learning", dl: "deep learning", "sklearn": "scikit-learn",
  "restful": "rest api", "rest apis": "rest api", "restful api": "rest api", "restful apis": "rest api", "vuejs": "vue", "vue.js": "vue",
  "angularjs": "angular", "springboot": "spring boot", "gen ai": "generative ai", "genai": "generative ai", "large language models": "llm", "llms": "llm",
  "oops": "oop", "ms excel": "excel", "microsoft excel": "excel", "powerbi": "power bi", "google cloud platform": "gcp", "amazon web services": "aws",
  "cicd": "ci/cd", "ci-cd": "ci/cd", "dsa": "data structures", "ux design": "ux", "ui design": "ui"
};

const STOP = new Set(("a an the and or for to of in on at by with from as is are be been being this that these those you your we our they their it its will would can could should may must have has had do does did not no yes " +
  "job role position candidate candidates team company work working experience years year month months skills skill ability strong good excellent knowledge understanding required requirements preferred plus " +
  "responsibilities responsible including include etc using use used new about who what when where why how all any each other more most such than then them there into over under within across also well " +
  "apply application salary benefits opportunity opportunities based looking join us please must-have nice-to-have day days week weeks time full part per lpa ctc india remote hybrid office location " +
  "bachelor bachelors degree graduate graduates fresher freshers intern interns internship b.tech btech b.e be m.tech mca bca bsc msc eligible eligibility batch").split(/\s+/));

export const norm = (t: string) => ` ${(t || "").toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/[^a-z0-9+#./\-\s]/g, " ").replace(/\s+/g, " ")} `;

function canon(term: string) { const t = term.toLowerCase().trim(); return SYNONYMS[t] || t; }

/** Does normalised text contain the term as a whole word/phrase (with synonyms)? */
export function hasTerm(normText: string, term: string): boolean {
  const variants = [term, ...Object.entries(SYNONYMS).filter(([, v]) => v === term).map(([k]) => k)];
  return variants.some((v) => {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s,(/])${esc}(?=$|[\\s,.)/:;])`).test(normText);
  });
}

export type Keyword = { term: string; weight: number };

/** Extract up to `max` keywords from a job description: known skills first (weight by frequency), then repeated significant words. */
export function extractKeywords(jd: string, max = 25): Keyword[] {
  const text = norm(jd);
  const found = new Map<string, number>();
  for (const sk of SKILLS) {
    if (sk.length <= 1) continue; // "c" and "r" are too ambiguous unless written as a skill list item
    if (hasTerm(text, sk)) {
      const esc = sk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const count = (text.match(new RegExp(`(^|[\\s,(/])${esc}(?=$|[\\s,.)/:;])`, "g")) || []).length || 1;
      found.set(canon(sk), Math.max(found.get(canon(sk)) || 0, count));
    }
  }
  // Drop generic terms covered by a more specific one ("rest" when "rest api", "ui" when "ui/ux").
  for (const [a] of found) for (const [b] of found) if (a !== b && b.includes(a) && a.length < b.length && ["rest", "api", "ui", "ux", "testing"].includes(a)) found.delete(a);

  const out: Keyword[] = [...found.entries()].map(([term, c]) => ({ term, weight: 2 + Math.min(c, 4) }));
  if (out.length < max) {
    const freq = new Map<string, number>();
    for (const w of text.split(/\s+/)) {
      const t = w.replace(/^[./\-]+|[./\-]+$/g, "");
      if (t.length < 4 || STOP.has(t) || /^\d/.test(t) || found.has(t)) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    [...freq.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, max - out.length)
      .forEach(([term, c]) => out.push({ term, weight: Math.min(c, 3) }));
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, max);
}

export type AtsResult = { score: number; matched: string[]; missing: string[]; total: number };

export function atsScore(jd: string, resumeText: string, keywords?: Keyword[]): AtsResult {
  const kws = keywords || extractKeywords(jd);
  if (!kws.length) return { score: 0, matched: [], missing: [], total: 0 };
  const r = norm(resumeText);
  let got = 0, all = 0; const matched: string[] = [], missing: string[] = [];
  for (const k of kws) { all += k.weight; if (hasTerm(r, k.term)) { got += k.weight; matched.push(k.term); } else missing.push(k.term); }
  return { score: Math.round((got / all) * 100), matched, missing, total: kws.length };
}

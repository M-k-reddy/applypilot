import { escapeRegExp } from "./text";

/**
 * Skill dictionary used for deterministic keyword coverage (ATS check + match score).
 * name = canonical label, aliases = other spellings. Edit freely.
 */
const SKILLS: [string, string[]][] = [
  // languages
  ["Python", []], ["Java", []], ["JavaScript", ["ecmascript"]], ["TypeScript", []], ["C++", ["cpp"]],
  ["C#", ["csharp", ".net c#"]], ["Go", ["golang"]], ["Rust", []], ["Kotlin", []], ["Swift", []], ["Scala", []],
  ["Ruby", []], ["PHP", []], ["Dart", []], ["SQL", []], ["Bash", ["shell scripting"]], ["MATLAB", []], ["R", []], ["C", []],
  // web
  ["React", ["react.js", "reactjs"]], ["Next.js", ["nextjs"]], ["Angular", []], ["Vue", ["vue.js", "vuejs"]],
  ["Node.js", ["nodejs", "node"]], ["Express", ["express.js", "expressjs"]], ["Django", []], ["Flask", []], ["FastAPI", []],
  ["Spring Boot", ["springboot", "spring framework"]], ["HTML", ["html5"]], ["CSS", ["css3"]], ["Tailwind", ["tailwindcss"]], ["Redux", []],
  ["GraphQL", []], ["REST API", ["restful", "rest apis", "rest api"]], ["Flutter", []], ["React Native", []], ["Android", []], ["iOS", []],
  // data / ml
  ["Machine Learning", ["ml"]], ["Deep Learning", ["dl"]], ["NLP", ["natural language processing"]], ["Computer Vision", ["opencv"]],
  ["LLM", ["llms", "large language models"]], ["RAG", ["retrieval augmented generation", "retrieval-augmented generation"]],
  ["Generative AI", ["genai", "gen ai"]], ["Prompt Engineering", []], ["LangChain", []], ["LlamaIndex", []], ["Hugging Face", ["huggingface", "transformers"]],
  ["TensorFlow", []], ["PyTorch", []], ["Keras", []], ["scikit-learn", ["sklearn", "scikit learn"]], ["Pandas", []], ["NumPy", []],
  ["Matplotlib", []], ["Spark", ["pyspark", "apache spark"]], ["Hadoop", []], ["Airflow", []], ["Kafka", []], ["Tableau", []], ["Power BI", ["powerbi"]],
  ["Excel", []], ["Statistics", []], ["Data Analysis", ["data analytics"]], ["Data Structures", ["dsa", "data structures and algorithms"]], ["Algorithms", []],
  ["Vector Database", ["vector db", "pinecone", "faiss", "chromadb", "weaviate", "qdrant"]], ["MLOps", []], ["YOLO", []],
  // db
  ["PostgreSQL", ["postgres"]], ["MySQL", []], ["MongoDB", ["mongo"]], ["Redis", []], ["Firebase", []], ["Supabase", []],
  ["DynamoDB", []], ["Elasticsearch", []], ["Snowflake", []], ["BigQuery", []],
  // cloud / devops
  ["AWS", ["amazon web services"]], ["GCP", ["google cloud", "google cloud platform"]], ["Azure", []], ["Docker", []], ["Kubernetes", ["k8s"]],
  ["Terraform", []], ["CI/CD", ["ci cd", "github actions", "jenkins"]], ["Linux", []], ["Git", ["github", "gitlab"]], ["Cloud Run", []],
  ["Microservices", []], ["Serverless", ["lambda"]], ["Nginx", []],
  // cs / practice
  ["OOP", ["object oriented programming", "object-oriented"]], ["System Design", []], ["DBMS", []], ["Operating Systems", []],
  ["Computer Networks", ["networking"]], ["Agile", ["scrum"]], ["Unit Testing", ["jest", "pytest", "junit", "testing"]],
  ["Selenium", []], ["Figma", []], ["Jira", []], ["Embedded Systems", ["embedded"]], ["IoT", []], ["Arduino", []],
  ["VLSI", []], ["Verilog", []], ["Communication", ["communication skills"]], ["Problem Solving", []]
];

type Entry = { name: string; re: RegExp };
const ENTRIES: Entry[] = SKILLS.map(([name, aliases]) => {
  const terms = [name, ...aliases];
  // single-letter languages need strict, case-sensitive matching to avoid false positives
  if (name === "C" || name === "R") return { name, re: new RegExp(`(^|[\\s,(/])${name}(?![+#\\w])(?=[\\s,)/.;]|$)`) };
  if (name === "Go") return { name, re: /\b(golang|Go(?= (?:language|lang)\b))/ };
  const alt = terms.map((t) => escapeRegExp(t.toLowerCase())).join("|");
  return { name, re: new RegExp(`(^|[^a-z0-9+#])(${alt})(?![a-z0-9+#])`, "i") };
});

/** Canonical skills found in a text. */
export function extractSkills(text: string): string[] {
  const t = text || "";
  return ENTRIES.filter((e) => e.re.test(t)).map((e) => e.name);
}

const STOP = new Set(("a an the and or of to in for on with at by from as is are be will you your we our us this that it its they their " +
  "have has had not but if can may must should would could also about into over more most such other any all each who what when where " +
  "which while within across including include etc using use used work working team teams role job candidate candidates experience years " +
  "year strong good great ability skills skill knowledge understanding plus preferred required requirements responsibilities qualifications " +
  "company opportunity apply join help new well based environment looking build building support across within day days time per").split(" "));

/** Top non-stopword terms of a JD, for keyword coverage beyond the skill dictionary. */
export function topTerms(text: string, n = 25): string[] {
  const counts = new Map<string, number>();
  for (const w of (text || "").toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []) {
    const k = w.replace(/[.-]+$/, "");
    if (STOP.has(k) || k.length < 3) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/** Skills in the JD, split by whether the resume/profile text has them. */
export function skillGap(candidateText: string, jdText: string) {
  const have = new Set(extractSkills(candidateText));
  const want = extractSkills(jdText);
  return { required: want, matched: want.filter((s) => have.has(s)), missing: want.filter((s) => !have.has(s)) };
}

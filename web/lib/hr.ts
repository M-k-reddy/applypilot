import { promises as dns } from "dns";
import { decodeEntities, fetchWithTimeout, pool } from "./text";

/**
 * Free "find the hiring contact" helpers.
 * - Scrapes a few public pages on the company's own site for published addresses (careers@, hr@, hiring@ …).
 * - Builds pattern guesses for named people (first.last@, first@, flast@, firstl@). Guesses are UNVERIFIED.
 * - Checks the domain has MX records (it can receive email at all). No SMTP probing, ever.
 */
export type FoundEmail = { email: string; kind: "hiring" | "general"; source: string };
export type GuessEmail = { email: string; pattern: string; person?: string; verified: false; label: "unverified guess" };

const PAGES = ["", "/careers", "/careers/", "/jobs", "/contact", "/contact-us", "/about", "/about-us", "/company/careers", "/join-us"];
const HIRING_RE = /^(careers?|jobs?|hiring|hr|recruit(ment|ing|er)?s?|talent|people|hr\.india|campus|placements?|join|work)(?:[._-]|$)/i;

export function cleanDomain(input: string): string {
  return (input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
}

export async function hasMx(domain: string): Promise<{ ok: boolean; hosts: string[] }> {
  try {
    const mx = await dns.resolveMx(domain);
    return { ok: mx.length > 0, hosts: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).slice(0, 3) };
  } catch { return { ok: false, hosts: [] }; }
}

/** Guess a company's domain from its name: tries name.com/.in/.ai/.io/.co and keeps the first with MX records. */
export async function guessDomain(company: string): Promise<string | null> {
  const slug = (company || "").toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|technologies|technology|software|solutions|labs)\b/g, "").replace(/[^a-z0-9]/g, "");
  if (!slug) return null;
  for (const tld of [".com", ".in", ".ai", ".io", ".co"]) if ((await hasMx(slug + tld)).ok) return slug + tld;
  return null;
}

function emailsIn(html: string, domain: string): string[] {
  const text = decodeEntities(html)
    .replace(/\\u([0-9a-f]{4})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))) // JSON-escaped HTML in script tags
    .replace(/%40/g, "@")
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@").replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = new Set<string>();
  for (const m of text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []) {
    const e = m.toLowerCase().replace(/\.+$/, "");
    const d = e.split("@")[1];
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e)) continue;
    if (d === domain || d.endsWith("." + domain)) found.add(e);
  }
  return [...found];
}

export async function scrapeCompanyEmails(domain: string): Promise<{ emails: FoundEmail[]; pagesChecked: string[] }> {
  const base = `https://${domain}`;
  const checked: string[] = [];
  const results = await pool(PAGES, 4, async (p) => {
    try {
      const r = await fetchWithTimeout(base + p, { redirect: "follow" }, 8000);
      if (!r.ok || !/text\/html/i.test(r.headers.get("content-type") || "")) return [];
      const html = (await r.text()).slice(0, 1_500_000);
      checked.push(base + p);
      return emailsIn(html, domain).map((email) => ({ email, source: base + p }));
    } catch { return []; }
  });
  const map = new Map<string, FoundEmail>();
  for (const { email, source } of results.flat()) {
    if (map.has(email)) continue;
    map.set(email, { email, source, kind: HIRING_RE.test(email.split("@")[0]) ? "hiring" : "general" });
  }
  const emails = [...map.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "hiring" ? -1 : 1));
  return { emails, pagesChecked: checked };
}

const ascii = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s-]/g, " ").trim();

/** first.last, first, flast, firstl, firstlast for one person. All unverified. */
export function patternGuesses(fullName: string, domain: string): GuessEmail[] {
  const parts = ascii(fullName).split(/[\s-]+/).filter((p) => p.length > 0 && !["mr", "ms", "mrs", "dr"].includes(p));
  if (!parts.length) return [];
  const f = parts[0], l = parts.length > 1 ? parts[parts.length - 1] : "";
  const pats: [string, string][] = l
    ? [["first.last", `${f}.${l}`], ["first", f], ["flast", `${f[0]}${l}`], ["firstl", `${f}${l[0]}`], ["firstlast", `${f}${l}`], ["first_last", `${f}_${l}`]]
    : [["first", f]];
  return pats.map(([pattern, local]) => ({ email: `${local}@${domain}`, pattern, person: fullName, verified: false as const, label: "unverified guess" as const }));
}

export function genericGuesses(domain: string): GuessEmail[] {
  return ["careers", "hr", "hiring", "recruitment", "talent"].map((l) => ({ email: `${l}@${domain}`, pattern: "role address", verified: false as const, label: "unverified guess" as const }));
}

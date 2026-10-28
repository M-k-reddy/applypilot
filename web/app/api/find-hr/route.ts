import { requireUser, handle, HttpError } from "@/lib/supabase";
import { cleanDomain, genericGuesses, guessDomain, hasMx, patternGuesses, scrapeCompanyEmails } from "@/lib/hr";
import { checkQuota, recordUsage } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 POST { domain?, company?, people?: [{ name, title?, profileUrl? }] | string[] }
 -> { domain, domain_guessed, mx: {ok, hosts}, published: [{email, kind, source}], guesses: [{email, pattern, person, label:"unverified guess"}], people, pagesChecked, note }
 Free only: public pages on the company's own site + DNS MX lookup. No SMTP probing, no paid APIs.
*/
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const b = await req.json();
  await checkQuota(db, user.id, "find_hr");

  let domain = cleanDomain(b.domain || "");
  let domainGuessed = false;
  if (!domain && b.company) { domain = (await guessDomain(String(b.company))) || ""; domainGuessed = !!domain; }
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new HttpError(400, "Add the company's website domain, e.g. razorpay.com");

  const people: { name: string; title?: string; profileUrl?: string }[] = (b.people || b.names || [])
    .map((p: any) => (typeof p === "string" ? { name: p } : p)).filter((p: any) => p?.name).slice(0, 5);

  const [mx, scraped] = await Promise.all([hasMx(domain), scrapeCompanyEmails(domain)]);
  const guesses = mx.ok ? [...people.flatMap((p) => patternGuesses(p.name, domain)), ...genericGuesses(domain)] : [];
  const published = new Set(scraped.emails.map((e) => e.email));

  await recordUsage(db, user.id, "find_hr", { domain });
  return Response.json({
    domain, domain_guessed: domainGuessed, mx,
    published: scraped.emails,
    guesses: guesses.filter((g) => !published.has(g.email)),
    people, pagesChecked: scraped.pagesChecked,
    note: mx.ok
      ? "Published addresses were found on the company's own pages. Guesses follow common patterns and are NOT verified; one may bounce. Prefer a published address or a LinkedIn message."
      : "This domain has no MX records, so it cannot receive email. Check the domain."
  });
});

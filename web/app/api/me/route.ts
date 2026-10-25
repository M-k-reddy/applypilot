import { requireUser, handle, preflight } from "@/lib/supabase";
import { getPlan, usageThisMonth, freeLimits, billingEnabled, istMonthStart } from "@/lib/quota";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// GET -> plan, this month's usage (IST month), limits, and whether billing is enabled.
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const [plan, usage, prof] = await Promise.all([
    getPlan(db, user.id), usageThisMonth(db, user.id),
    db.from("profiles").select("email, profile_json").eq("id", user.id).maybeSingle()
  ]);
  const p = prof.data?.profile_json;
  return Response.json({
    email: user.email || prof.data?.email || "", plan, usage, limits: freeLimits(), monthStart: istMonthStart(),
    billingEnabled: billingEnabled(), hasProfile: !!(p && (p.full_name || p.skills?.length)), name: p?.full_name || ""
  });
});

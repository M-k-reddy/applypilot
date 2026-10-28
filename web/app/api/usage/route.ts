import { requireUser, handle } from "@/lib/supabase";
import { usageSummary } from "@/lib/limits";

export async function OPTIONS() { return new Response(null, { status: 204 }); }

// GET -> { plan, features: [{feature, label, used, limit|null}] }
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  return Response.json(await usageSummary(db, user.id));
});

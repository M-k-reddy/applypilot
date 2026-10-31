import { createClient } from "@supabase/supabase-js";
import { handle, HttpError } from "@/lib/supabase";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/* POST { refresh_token } -> { access_token, refresh_token, expires_at }  (used by the Chrome extension) */
export const POST = handle(async (req) => {
  const { refresh_token } = await req.json().catch(() => ({}));
  if (!refresh_token) throw new HttpError(400, "Missing refresh_token");
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.refreshSession({ refresh_token });
  if (error || !data.session) throw new HttpError(401, "Extension token expired. Generate a new one on the Dashboard.");
  const s = data.session;
  return Response.json({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
});

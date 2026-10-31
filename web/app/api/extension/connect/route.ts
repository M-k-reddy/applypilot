import { createClient } from "@supabase/supabase-js";
import { requireUser, adminClient, handle, HttpError } from "@/lib/supabase";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { status: 204 }); }

/*
 POST (signed in) -> { token: "ap1.<refresh_token>" }
 Creates a separate Supabase session just for the Chrome extension (no email is sent),
 so the extension can keep itself signed in with its own refresh token and never
 collides with the browser's dashboard session.
*/
export const POST = handle(async (req) => {
  const { user } = await requireUser(req);
  if (!user.email) throw new HttpError(400, "Your account has no email");
  const admin = adminClient();
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (error || !link?.properties?.hashed_token) throw new HttpError(500, error?.message || "Could not create extension session");
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2 || !data.session) throw new HttpError(500, e2?.message || "Could not create extension session");
  return Response.json({ token: `ap1.${data.session.refresh_token}` });
});

import crypto from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/*
 Server-side auth + DB helpers.
 - Every API route runs with the service-role client and MUST scope queries by user.id.
 - A request is authenticated by either a Supabase JWT (dashboard) or a long-lived
   per-user API key "Bearer ap_..." (extension), looked up by its sha256 hash.
 Tolerates missing env at build time: clients are only created when a request arrives.
*/

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

let _admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  if (!url() || !serviceKey()) throw new HttpError(503, "Server is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  if (!_admin) _admin = createClient(url(), serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export type AuthedUser = { id: string; email?: string; via: "jwt" | "api_key" };

/** Authenticate a request. Set allowApiKey=false for routes only the dashboard may call (key management, billing). */
export async function requireUser(req: Request, opts: { allowApiKey?: boolean } = {}): Promise<{ user: AuthedUser; db: SupabaseClient }> {
  const allowApiKey = opts.allowApiKey ?? true;
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Missing token. Sign in again or paste your API key.");
  const db = adminClient();

  if (token.startsWith("ap_")) {
    if (!allowApiKey) throw new HttpError(403, "This action needs a dashboard sign-in, not an API key.");
    if (!/^ap_[A-Za-z0-9_-]{20,80}$/.test(token)) throw new HttpError(401, "Malformed API key");
    const { data, error } = await db.from("api_keys").select("id, user_id, last_used")
      .eq("key_hash", sha256(token)).is("revoked_at", null).maybeSingle();
    if (error || !data) throw new HttpError(401, "Invalid or revoked API key. Create a new one in Dashboard → Extension.");
    // Throttle last_used writes to once every 5 minutes.
    if (!data.last_used || Date.now() - new Date(data.last_used).getTime() > 5 * 60_000)
      await db.from("api_keys").update({ last_used: new Date().toISOString() }).eq("id", data.id);
    return { user: { id: data.user_id, via: "api_key" }, db };
  }

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session expired. Sign in again.");
  return { user: { id: data.user.id, email: data.user.email, via: "jwt" }, db };
}

export async function readJSON<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, "Body must be valid JSON"); }
}

export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try { return await fn(req, ctx); }
    catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      const msg = status === 500 ? "Something went wrong on our side. Please try again." : e.message;
      return Response.json({ error: msg }, { status });
    }
  };
}

export const preflight = () => new Response(null, { status: 204 });

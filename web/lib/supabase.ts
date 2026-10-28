import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const browserClient = () => createClient(url, anon);
export const adminClient = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** Authenticate an API request by its Bearer token (dashboard or extension). */
export async function requireUser(req: Request): Promise<{ user: { id: string; email?: string }; db: SupabaseClient }> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new HttpError(401, "Missing token");
  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid token");
  return { user: { id: data.user.id, email: data.user.email }, db };
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try { return await fn(req); }
    catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      return Response.json({ error: e.message ?? "Server error" }, { status });
    }
  };
}

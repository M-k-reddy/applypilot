"use client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Browser client for auth only (sign-in, session). All data goes through /api routes.
// Falls back to placeholders so static prerender at build time never throws.
const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321").trim().replace(/\/(rest\/v1\/?)?$/, "").replace(/\/+$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "public-anon-key-missing";
export const supabaseConfigured = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export function browserClient(): SupabaseClient {
  if (!client) client = createClient(URL_, ANON);
  return client;
}

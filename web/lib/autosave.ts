import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";
import { normalizeAutoSettings, AutoSettings } from "./autosettings";
import { getPlan, autoDailyMax } from "./quota";

/** The one save path for profiles.auto_settings: normalize, clamp daily_cap to the plan's max, write. */
export async function saveAutoSettings(db: SupabaseClient, userId: string, raw: unknown): Promise<{ settings: AutoSettings; max: number }> {
  const settings = normalizeAutoSettings(raw);
  const max = autoDailyMax(await getPlan(db, userId));
  settings.daily_cap = Math.min(settings.daily_cap, max);
  const { error } = await db.from("profiles").update({ auto_settings: settings, updated_at: new Date().toISOString() }).eq("id", userId);
  if (error) throw new HttpError(500, error.message);
  return { settings, max };
}

export async function loadAutoSettings(db: SupabaseClient, userId: string): Promise<AutoSettings> {
  const { data, error } = await db.from("profiles").select("auto_settings").eq("id", userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return normalizeAutoSettings(data?.auto_settings);
}

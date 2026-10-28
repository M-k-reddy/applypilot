import { HttpError } from "./supabase";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Reject anything else. */
export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(500, "Set CRON_SECRET to enable cron routes");
  if (req.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Bad cron secret");
}

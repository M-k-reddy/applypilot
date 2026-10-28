import crypto from "crypto";
import { adminClient } from "@/lib/supabase";

export const runtime = "nodejs";

// Razorpay webhook: subscription.activated / charged -> pro, cancelled / halted -> free
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(body).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return new Response("bad signature", { status: 400 });

  const evt = JSON.parse(body);
  const sub = evt.payload?.subscription?.entity;
  const userId = sub?.notes?.user_id;
  if (userId) {
    const pro = ["subscription.activated", "subscription.charged", "subscription.resumed"].includes(evt.event);
    const free = ["subscription.cancelled", "subscription.halted", "subscription.completed"].includes(evt.event);
    if (pro || free) await adminClient().from("profiles").update({ plan: pro ? "pro" : "free" }).eq("id", userId);
  }
  return new Response("ok");
}

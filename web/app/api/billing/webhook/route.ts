import crypto from "crypto";
import { adminClient } from "@/lib/supabase";
import { UUID } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay webhook (signed). subscription.activated / charged / resumed -> pro; cancelled / halted / completed -> free.
// Writes the plan with the service role only.
export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return new Response("billing disabled", { status: 501 });
  const body = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return new Response("bad signature", { status: 400 });

  let evt: any; try { evt = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  const sub = evt.payload?.subscription?.entity;
  const userId = sub?.notes?.user_id;
  if (typeof userId === "string" && UUID.test(userId)) {
    const pro = ["subscription.activated", "subscription.charged", "subscription.resumed"].includes(evt.event);
    const free = ["subscription.cancelled", "subscription.halted", "subscription.completed"].includes(evt.event);
    if (pro || free) {
      const { error } = await adminClient().from("subscriptions").upsert({
        user_id: userId, plan: pro ? "pro" : "free", status: sub.status || evt.event, razorpay_subscription_id: sub.id,
        current_period_end: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null, updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (error) return new Response("db error", { status: 500 });
    }
  }
  return new Response("ok");
}

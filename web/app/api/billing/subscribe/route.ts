import Razorpay from "razorpay";
import { requireUser, handle, adminClient } from "@/lib/supabase";

export const runtime = "nodejs";

// POST -> creates a Razorpay subscription and returns its id for Checkout
export const POST = handle(async (req) => {
  const { user } = await requireUser(req);
  const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
  const sub = await rzp.subscriptions.create({
    plan_id: process.env.RAZORPAY_PLAN_ID!, total_count: 12, customer_notify: 1, notes: { user_id: user.id }
  });
  await adminClient().from("profiles").update({ razorpay_subscription_id: sub.id }).eq("id", user.id);
  return Response.json({ subscriptionId: sub.id, keyId: process.env.RAZORPAY_KEY_ID });
});

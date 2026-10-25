import Razorpay from "razorpay";
import { requireUser, handle, HttpError } from "@/lib/supabase";
import { billingEnabled } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST -> creates a Razorpay subscription and returns its id for Checkout. Optional: 501 when Razorpay env is missing.
export const POST = handle(async (req) => {
  if (!billingEnabled()) throw new HttpError(501, "Billing is not enabled on this deployment.");
  const { user, db } = await requireUser(req, { allowApiKey: false });
  const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
  const sub = await rzp.subscriptions.create({
    plan_id: process.env.RAZORPAY_PLAN_ID!, total_count: 12, customer_notify: 1, notes: { user_id: user.id }
  });
  // Only the subscription id is recorded here; the plan flips to "pro" only from the signed webhook.
  const { error } = await db.from("subscriptions").upsert({ user_id: user.id, razorpay_subscription_id: sub.id, status: "created", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new HttpError(500, error.message);
  return Response.json({ subscriptionId: sub.id, keyId: process.env.RAZORPAY_KEY_ID });
});

"use client";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Meter, Spinner } from "@/components/ui";

declare global { interface Window { Razorpay?: any } }

const ROWS: [string, string][] = [["analysis", "Fit analyses & interview prep"], ["tailor", "Resume tailors"], ["cover_letter", "Cover letters"], ["autofill", "Autofills"], ["parse", "Resume parses"]];

export default function BillingPage() {
  const { api, me, toast, refreshMe } = useApp();
  const { busy, run } = useBusy();
  const pro = me?.plan === "pro";
  const reset = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString("en-IN", { day: "numeric", month: "long" }); })();

  const upgrade = () => run("upgrade", async () => {
    const { subscriptionId, keyId } = await api<{ subscriptionId: string; keyId: string }>("/api/billing/subscribe", { method: "POST" });
    if (!window.Razorpay) await new Promise<void>((res, rej) => { const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = () => res(); s.onerror = () => rej(new Error("Could not load Razorpay")); document.body.appendChild(s); });
    new window.Razorpay({ key: keyId, subscription_id: subscriptionId, name: "ApplyPilot Pro", description: "₹149 / month", prefill: { email: me?.email },
      handler: () => { toast("Payment received. Pro unlocks in a few seconds."); setTimeout(refreshMe, 4000); } }).open();
  });

  return (
    <>
      <PageHead title="Billing" sub={`You are on the ${pro ? "Pro" : "Free"} plan. Free quotas reset on ${reset} (IST).`} />
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Usage this month</h3><span className={`badge ${pro ? "badge-brand" : ""}`}>{pro ? "Pro · unlimited" : "Free"}</span></div>
          <div className="stack" style={{ gap: 14 }}>
            {ROWS.map(([k, l]) => <Meter key={k} label={l} used={me?.usage?.[k] ?? 0} limit={me?.limits?.[k] ?? 0} unlimited={pro} />)}
          </div>
          <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>Deleting tracker cards does not change usage. A multi-step application counts as one autofill.</p>
        </div>
        {me?.billingEnabled ? (
          <div className="price-card featured">
            <span className="badge badge-brand">Pro</span>
            <div className="price">₹149 <small>/ month</small></div>
            <ul className="ticks"><li>Unlimited analyses, tailors and cover letters</li><li>Unlimited autofills</li><li>Cancel anytime</li></ul>
            {pro ? <div className="alert alert-ok">You are on Pro. Thank you!</div>
              : <button className="btn btn-grad btn-lg" onClick={upgrade} disabled={!!busy}>{busy ? <Spinner label="Opening checkout…" /> : "Upgrade with Razorpay"}</button>}
          </div>
        ) : (
          <div className="card">
            <h3>Free for everyone</h3>
            <p className="muted mb-0">Paid plans are not enabled on this deployment, so everyone uses the free monthly quotas.</p>
          </div>
        )}
      </div>
    </>
  );
}

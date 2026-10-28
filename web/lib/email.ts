/**
 * Optional email via Resend's HTTP API (free tier). No SDK dependency.
 * Returns false (and does nothing) when RESEND_API_KEY is not set; callers fall back to in-app notifications.
 */
export const emailEnabled = () => !!process.env.RESEND_API_KEY;

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailEnabled()) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERTS_FROM_EMAIL || "ApplyPilot <onboarding@resend.dev>", to: [to], subject, html })
  });
  return r.ok;
}

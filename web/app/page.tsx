import Link from "next/link";
import { Icon } from "@/components/ui";

const FEATURES: [string, string, string][] = [
  ["check", "ATS check", "25+ checks on contact info, sections, action verbs, numbers, keywords and formatting, each with a clear fix."],
  ["bolt", "Match score", "Every job scored 0–100 on your skills and experience, with matched and missing skills at a glance."],
  ["doc", "Tailored resume", "A clean one-page resume for each job, built only from your real experience. Save it as PDF."],
  ["briefcase", "Free job feed", "New roles daily, straight from company job boards. Fresher mode hides anything asking for 3+ years."],
  ["user", "Find HR", "Hiring emails published on the company's own site, plus clearly-labelled pattern guesses."],
  ["send", "Referral notes", "A short cold email and a LinkedIn referral note per job. You send them from your own accounts."],
  ["board", "Tracker", "Saved, applied, interview, offer. One calm board for every application, synced with the extension."],
  ["sparkle", "Autofill", "The Chrome extension fills application forms from your profile. Sensitive questions are left to you."]
];

const STEPS: [string, string][] = [
  ["Upload your resume", "We turn it into a reusable profile and run an ATS check straight away."],
  ["Pick your jobs", "Browse the daily feed ranked by match, or save any job from LinkedIn with the extension."],
  ["Tailor and reach out", "Generate a tailored resume and a referral note, then find who to send it to."],
  ["Apply and track", "The extension fills the form, you click Submit, and the tracker keeps score."]
];

const FAQ: [string, string][] = [
  ["Does ApplyPilot apply to jobs for me?", "No. It fills forms and drafts messages, but you always review and click Submit or Send yourself. That keeps you in control and keeps your accounts safe."],
  ["Will it make things up on my resume?", "No. Tailoring only reorders and rephrases what's already on your resume. Skills the AI adds that you don't have are removed automatically, and suggested metrics are marked as placeholders for you to fill in only if true."],
  ["Where do the jobs come from?", "Public job boards that companies run on Greenhouse, Lever, Ashby, Workable and SmartRecruiters. They're refreshed daily, and you can add companies to the list."],
  ["Are the HR emails verified?", "Addresses published on a company's own site are shown as published. Pattern guesses (like first.last@) are clearly labelled unverified. We never probe mail servers."],
  ["What does the free plan include?", "5 ATS checks, 2 tailored resumes, 5 autofills, 5 outreach drafts and 5 HR lookups every month, plus the unlimited job feed and match scores."]
];

export default function Home() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="container">
          <Link href="/" className="brand" style={{ padding: 0 }}><span className="logo">A</span>ApplyPilot</Link>
          <nav><a href="#features">Features</a><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav>
          <div className="row"><Link href="/dashboard" className="btn ghost">Sign in</Link></div>
        </div>
      </header>

      <section className="hero-wrap">
        <div className="container">
          <div className="hero">
            <span className="eyebrow"><Icon name="sparkle" size={14} />Built for freshers and early-career engineers</span>
            <h1>Land interviews,<br /><em>not rejections.</em></h1>
            <p>Check your resume against ATS, see how well you match each job, tailor it in one click, and reach the hiring team. You stay in control of every application.</p>
            <div className="ctas">
              <Link href="/dashboard" className="btn primary lg">Get started free</Link>
              <a href="#how" className="btn lg">See how it works</a>
            </div>
            <div className="note">No card needed · Free plan every month</div>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Features</span>
            <h2>Everything for your job search, in one place</h2>
            <p>From your first resume check to the offer letter.</p>
          </div>
          <div className="grid grid-4">
            {FEATURES.map(([icon, t, d]) => (
              <div className="feature" key={t}>
                <div className="icon"><Icon name={icon} /></div>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section-head">
            <span className="kicker">How it works</span>
            <h2>Four steps, about ten minutes</h2>
          </div>
          <div className="grid grid-4">
            {STEPS.map(([t, d], i) => (
              <div className="step" key={t}>
                <span className="step-num">{i + 1}</span>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Pricing</span>
            <h2>Start free. Upgrade when it's working.</h2>
          </div>
          <div className="grid grid-2" style={{ maxWidth: 800, margin: "0 auto" }}>
            <div className="price">
              <div><h3>Free</h3><p className="muted sm" style={{ marginTop: 8 }}>For getting started</p></div>
              <div className="amount">₹0<span> / month</span></div>
              <ul><li>5 ATS checks</li><li>2 tailored resumes</li><li>5 autofills</li><li>5 outreach drafts and 5 HR lookups</li><li>Unlimited job feed, match scores and alerts</li></ul>
              <Link href="/dashboard" className="btn lg">Start free</Link>
            </div>
            <div className="price featured">
              <div><div className="row between"><h3>Pro</h3><span className="chip accent">Most popular</span></div><p className="muted sm" style={{ marginTop: 8 }}>For an active job hunt</p></div>
              <div className="amount">₹149<span> / month</span></div>
              <ul><li>Unlimited ATS checks and AI fixes</li><li>Unlimited tailored resumes</li><li>Unlimited autofills</li><li>Unlimited outreach and HR lookups</li><li>Everything in Free</li></ul>
              <Link href="/dashboard" className="btn primary lg">Go Pro</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="container">
          <div className="section-head"><span className="kicker">FAQ</span><h2>Questions, answered</h2></div>
          <div className="faq">
            {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="row"><span className="logo" style={{ width: 24, height: 24, fontSize: 12 }}>A</span><span className="muted sm">© {new Date().getFullYear()} ApplyPilot</span></div>
          <nav><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><Link href="/dashboard">Sign in</Link></nav>
        </div>
      </footer>
    </div>
  );
}

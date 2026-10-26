import Link from "next/link";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";

const FEATURES = [
  { ico: "⇄", t: "See every edit before it lands", d: "Tailoring shows your old bullet and the new one side by side. Accept or reject each change; nothing is rewritten behind your back." },
  { ico: "◎", t: "Live ATS keyword score", d: "A deterministic keyword-coverage score updates instantly as you accept changes, with matched and missing keyword chips." },
  { ico: "✓", t: "Honesty check built in", d: "Rewrites that invent numbers are dropped automatically, and new skills you never listed are flagged in orange." },
  { ico: "✎", t: "Cover letters in seconds", d: "Under 200 words, built only from your real projects. Edit inline, copy, or download as .txt." },
  { ico: "⚡", t: "Safe autofill", d: "Fills forms on LinkedIn, Naukri, Internshala, Greenhouse, Lever and Workday. Salary and sensitive questions stay with you. In Review mode you click Submit; optional Auto mode submits only fully confident applications." },
  { ico: "★", t: "An answer bank that learns", d: "Answer a new question once and ApplyPilot remembers it for the next application." },
  { ico: "⌕", t: "Fresher-first job search", d: "Search Indian and remote jobs from free sources, filtered for freshers, interns, remote and city." },
  { ico: "?", t: "Interview prep", d: "8 likely questions per job, with answer pointers drawn from your own projects and skills." },
  { ico: "▦", t: "Kanban tracker", d: "Drag applications from Saved to Offer, add notes and follow-up dates, and see your weekly momentum." }
];

const COMPARE: [string, string, string][] = [
  ["Free plan every month", "30 analyses · 15 tailors · 10 cover letters · 50 autofills", "A few analyses and 1–2 tailors"],
  ["Paid plan", "₹149/month, optional", "Roughly ₹800–₹3,300/month"],
  ["Accept / reject each AI edit", "✓", "Varies"],
  ["Flags invented numbers and skills", "✓", "Rare"],
  ["Live ATS score while you review", "✓", "Sometimes"],
  ["Indian boards: Naukri and Internshala", "✓", "Often US-focused"],
  ["Answer bank learns from your answers", "✓", "Partial"],
  ["Review mode by default, Auto mode only if you opt in", "✓", "Varies"],
  ["Interview prep from your profile", "✓", "Often an add-on"],
  ["Kanban tracker with follow-up dates", "✓", "Basic list"]
];

const FAQ = [
  ["Is ApplyPilot really free?", "Yes. The free plan resets on the 1st of every month (IST) and covers 30 fit analyses, 15 resume tailors, 10 cover letters and 50 autofills. Job search, the ATS score and the tracker are always unlimited."],
  ["Will the AI make things up on my resume?", "It is told to use only facts from your profile, and every rewrite is checked: suggestions that add numbers you never wrote are dropped, and new skills are flagged so you can reject them. You approve every change."],
  ["Does it submit applications automatically?", "Only if you turn on Auto mode, which is off by default. In Review mode the extension fills what it can, outlines the Next or Submit button in blue, and you click it yourself. Auto mode works through jobs you saved, one at a time with a daily cap, and clicks Submit only when every required field is filled, nothing needs your answer (salary, personal or unknown questions) and there is no CAPTCHA or sign-in. Anything else goes to a Needs review column. LinkedIn is never automated."],
  ["Which sites does the extension support?", "Any job page with standard job data, plus dedicated support for LinkedIn, Naukri, Internshala, Indeed, Greenhouse, Lever and Workday. It only runs when you click it."],
  ["Is the ATS score the same as a company's ATS?", "No tool can see inside a company's ATS. Our score measures how many of the job description's important keywords appear in your resume, which is what keyword filters look for."],
  ["What happens to my data?", "Your resume and answers live in your own account and are used only to tailor and fill your applications. You can edit or delete them anytime."]
];

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav className="nav-links" aria-label="Main">
            <a href="#how">How it works</a><a href="#features">Features</a><a href="#compare">Compare</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
          </nav>
          <span className="spacer" />
          <ThemeToggle />
          <Link href="/dashboard" className="btn btn-ghost hide-sm">Sign in</Link>
          <Link href="/dashboard" className="btn btn-primary">Start free</Link>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <span className="eyebrow"><b>New</b> Visible edits · live ATS score · ₹0 to start</span>
              <h1 style={{ marginTop: 18 }}>Land interviews faster, <span className="gradient-text">without faking a single line.</span></h1>
              <p className="lead">ApplyPilot tailors your resume to each job with edits you can see and approve, writes honest cover letters, and fills application forms safely. Built for Indian freshers and students.</p>
              <div className="hero-cta">
                <Link href="/dashboard" className="btn btn-grad btn-lg">Tailor my resume free →</Link>
                <a href="#how" className="btn btn-lg">See how it works</a>
              </div>
              <div className="trust"><span>No card needed</span><span>Auto-submit only if you opt in</span><span>Prices in ₹</span></div>
            </div>

            <div className="mock" role="img" aria-label="Preview: a job application being filled while the ApplyPilot side panel shows a 86% ATS score and an accepted resume edit">
              <div className="mock-bar"><i /><i /><i /><span className="mock-url">careers.example.in/jobs/frontend-intern/apply</span></div>
              <div className="mock-body">
                <div className="mock-page">
                  <div className="mock-line" style={{ width: "60%", height: 14 }} />
                  <div className="mock-line" style={{ width: "40%" }} />
                  <div className="mock-field ok">Priya Sharma</div>
                  <div className="mock-field ok">priya@college.edu.in</div>
                  <div className="mock-field ok">B.Tech CSE · 2026</div>
                  <div className="mock-field ask">Expected CTC: you answer this</div>
                  <div className="mock-field ok">Immediate joiner</div>
                  <span className="mock-submit">Submit (you click)</span>
                </div>
                <div className="mock-side">
                  <div className="row" style={{ gap: 12 }}>
                    <div className="ring sm" style={{ ["--v" as string]: 86, ["--c" as string]: "var(--ok)" } as React.CSSProperties}><b>86</b></div>
                    <div><b style={{ fontSize: ".9rem" }}>Frontend Intern</b><div className="tiny muted">ATS match · up from 61</div></div>
                  </div>
                  <div className="chips"><span className="chip chip-ok">react</span><span className="chip chip-ok">rest api</span><span className="chip chip-ok">git</span><span className="chip chip-miss">jest</span></div>
                  <div className="mock-diff old">Made a website for college fest using React.</div>
                  <div className="mock-diff new">Built a responsive React web app for the college fest, integrating REST APIs for live event schedules.</div>
                  <div className="row"><span className="btn btn-sm btn-ok" aria-hidden="true">✓ Accept</span><span className="btn btn-sm" aria-hidden="true">Reject</span></div>
                </div>
              </div>
              <div className="mock-float"><span className="badge badge-ok">+25</span> ATS score after 3 edits</div>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="container">
            <div className="section-head"><span className="kicker">How it works</span><h2>From resume to applied in three steps</h2><p>Set up once, then apply to every job in minutes.</p></div>
            <div className="steps">
              <div className="step"><h3>Upload your resume</h3><p className="muted mb-0">AI turns your PDF into an editable profile and answer sheet: education, projects, skills, notice period and more.</p></div>
              <div className="step"><h3>Tailor to the job</h3><p className="muted mb-0">Open any job, review suggested edits side by side, and watch your ATS score climb as you accept them. Export a clean PDF.</p></div>
              <div className="step"><h3>Apply with the extension</h3><p className="muted mb-0">The side panel spots the job, saves it to your tracker and fills the form. You check it and click Submit, or let optional Auto mode submit the ones it is fully confident about.</p></div>
            </div>
          </div>
        </section>

        <section id="features" className="section section-alt">
          <div className="container">
            <div className="section-head"><span className="kicker">Features</span><h2>Everything a fresher needs to apply well</h2><p>Polished where it matters, honest everywhere.</p></div>
            <div className="grid grid-3">
              {FEATURES.map((f) => (
                <div className="feature" key={f.t}><div className="ico" aria-hidden="true">{f.ico}</div><h3>{f.t}</h3><p>{f.d}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section id="compare" className="section">
          <div className="container" style={{ maxWidth: 980 }}>
            <div className="section-head"><span className="kicker">Compare</span><h2>ApplyPilot vs typical tools</h2><p>More free usage, more control, priced for students.</p></div>
            <div className="table-scroll">
              <table className="compare">
                <thead><tr><th scope="col">What you get</th><th scope="col">ApplyPilot</th><th scope="col">Typical tools</th></tr></thead>
                <tbody>
                  {COMPARE.map(([k, a, b]) => (
                    <tr key={k}><th scope="row" style={{ fontWeight: 600 }}>{k}</th><td className={a === "✓" ? "yes" : ""}>{a === "✓" ? "✓ Included" : a}</td><td className="no">{b}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny muted center" style={{ marginTop: 12 }}>Typical tools: our summary of common AI job-application tools in 2026. Pricing converted approximately from USD.</p>
          </div>
        </section>

        <section id="pricing" className="section section-alt">
          <div className="container">
            <div className="section-head"><span className="kicker">Pricing</span><h2>Generous free plan. Pro if you want it.</h2><p>Quotas reset on the 1st of each month, Indian time.</p></div>
            <div className="pricing">
              <div className="price-card">
                <span className="badge">Free</span>
                <div className="price">₹0 <small>/ month</small></div>
                <p className="muted">Everything you need for an active job hunt.</p>
                <ul className="ticks">
                  <li>30 AI fit analyses & interview preps</li><li>15 resume tailors with visible edits</li><li>10 cover letters</li><li>50 autofills (a multi-step form counts once)</li>
                  <li>Unlimited job search, ATS score and tracker</li>
                </ul>
                <Link href="/dashboard" className="btn btn-lg" style={{ marginTop: "auto" }}>Start free</Link>
              </div>
              <div className="price-card featured">
                <span className="badge badge-brand">Pro · optional</span>
                <div className="price">₹149 <small>/ month</small></div>
                <p className="muted">For placement season, when you apply every day.</p>
                <ul className="ticks">
                  <li>Unlimited analyses, tailors and cover letters</li><li>Unlimited autofills</li><li>Everything in Free</li><li>Cancel anytime via Razorpay</li>
                </ul>
                <Link href="/dashboard/billing" className="btn btn-grad btn-lg" style={{ marginTop: "auto" }}>Go Pro</Link>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="section">
          <div className="container">
            <div className="section-head"><span className="kicker">FAQ</span><h2>Questions, answered</h2></div>
            <div className="faq">
              {FAQ.map(([q, a]) => (<details key={q}><summary>{q}</summary><p>{a}</p></details>))}
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="cta-band">
              <h2>Your next application can be your best one.</h2>
              <p>Upload your resume and tailor it to a real job in under a minute. Free.</p>
              <Link href="/dashboard" className="btn btn-lg">Get started free →</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-grid">
          <div><Logo /><p style={{ marginTop: 12, maxWidth: 380 }}>An honest AI copilot for job applications. You stay in control of every edit, and of whether it ever clicks Submit.</p></div>
          <div className="stack" style={{ gap: 2 }}><b style={{ color: "var(--text)" }}>Product</b><a href="#features">Features</a><a href="#pricing">Pricing</a><Link href="/dashboard/extension">Chrome extension</Link></div>
          <div className="stack" style={{ gap: 2 }}><b style={{ color: "var(--text)" }}>Account</b><Link href="/dashboard">Sign in</Link><Link href="/dashboard/profile">Your profile</Link><a href="#faq">FAQ</a></div>
        </div>
        <div className="container" style={{ marginTop: 28 }}>© {new Date().getFullYear()} ApplyPilot · Made in India 🇮🇳</div>
      </footer>
    </>
  );
}

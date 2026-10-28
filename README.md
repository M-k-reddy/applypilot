# ApplyPilot

A NextRaise-style job-search copilot for freshers: ATS check, job match scores, tailored resumes, a free daily job feed, job alerts, free HR finder, referral/outreach drafts, an application tracker, and a Chrome extension that fills application forms. **The user approves every submit and sends every message themselves.**

Everything runs on free data sources. No Hunter, Apollo or other paid enrichment APIs.

## Parts
- `web/`: Next.js 14 (App Router) + Supabase + Ollama Cloud (or Gemini) + Razorpay. Hand-rolled design system in `app/globals.css` + `components/ui.tsx` (light/dark, no UI kit).
- `extension/`: Chrome MV3 extension. Fills forms, saves jobs to the tracker, reads the LinkedIn "Meet the hiring team" card, finds HR contacts and drafts referral notes.

## Features
| Feature | Page | API | Notes |
|---|---|---|---|
| ATS check | `/ats` | `POST /api/ats`, `POST /api/ats/fix` | 25 rule checks (28 with a JD): contact info, sections, action verbs, quantified bullets, weak phrases, pronouns, clichés, bullet length, dates, length, parseability, columns/tables, icons, personal details, JD skill coverage, JD language, target title. Deterministic score /100 in `lib/ats.ts`; AI adds suggestions and rewrites (never changes the score). "AI fix" rewrites one bullet with `[X%]` placeholders instead of invented numbers. |
| Job match score | job cards on `/feed`, `/dashboard` | `POST /api/match` | `quick: true` = free deterministic score (70% skill coverage + 30% experience fit) with matched/missing skills and an experience verdict. Full mode blends 60% rules + 40% AI and adds reasons, tailored bullets and a cover letter. |
| Tailored resume | `/tailor` | `POST/GET /api/tailor` | Returns tailored JSON + an ATS-safe single-column HTML page with print CSS (browser "Save as PDF"). Contact details always come from the parsed profile; skills not on the resume are dropped and reported. |
| Free job feed | `/feed` | `GET /api/feed`, cron `GET /api/cron/feed` | Fetchers for Greenhouse, Lever, Ashby, Workable and SmartRecruiters public JSON APIs (`lib/feeds/`). Normalized to one `Job` type, enriched with experience range, fresher flag and skills, deduped, stored in `feed_jobs`. Filters: keywords, location (India city list, "Remote" means remote-from-India), fresher mode (rejects 3+ years and senior titles). JSearch stays optional (`RAPIDAPI_KEY`). |
| Company seed list | | | `lib/feeds/companies.ts` (**editable**, 37 boards incl. Groww, Razorpay, CRED, Meesho, Paytm, Sarvam AI, Swiggy, Freshworks, plus remote-friendly ones). Override at runtime with `FEED_COMPANIES_JSON`. |
| Job alerts | `/feed#alerts` | `/api/alerts`, `/api/notifications`, cron `GET /api/cron/alerts` | Daily: new feed jobs matching each alert become an in-app notification; emailed via Resend's HTTP API only when `RESEND_API_KEY` is set. |
| Find HR (free) | `/outreach`, extension | `POST /api/find-hr` | Scrapes up to 10 public pages on the company's own domain for published addresses (careers@, hr@, hiring@ …), DNS MX check (node `dns`), and pattern guesses (first.last, first, flast, firstl, firstlast, first_last) **labelled "unverified guess"**. No SMTP probing. The extension reads hiring-team names and profile links from the LinkedIn job page the user is viewing. |
| Super Apply / referral | `/outreach`, extension | `POST /api/outreach` | Cold email (subject + body), LinkedIn connection note and referral request (each capped at 300 chars). UI gives a `mailto:` link; nothing is sent by the server. |
| Tracker | `/tracker`, extension "Save job" | `GET/POST/DELETE /api/applications` | Kanban with drag and drop: saved → filled → applied → interview → offer / rejected, plus notes. Autofill moves a saved card to "filled". |
| Usage | dashboard, top bar | `GET /api/usage` | Per-feature monthly usage vs. limits. |

## Plans (enforced server-side in `lib/limits.ts`, counted in `usage_events`)
| Per month | Free | Pro (₹149, Razorpay) |
|---|---|---|
| ATS checks | 5 | unlimited |
| AI bullet fixes | 10 | unlimited |
| Tailored resumes | 2 | unlimited |
| Autofills | 5 | unlimited |
| AI match reports | 20 | unlimited |
| Outreach drafts | 5 | unlimited |
| HR lookups | 5 | unlimited |
| Job feed, quick match scores, alerts | unlimited | unlimited |

Override any cap with env vars (`FREE_MONTHLY_LIMIT` for autofill, `FREE_LIMIT_ATS`, `FREE_LIMIT_TAILOR`, …). Quota is recorded only after a successful call.

## Setup
1. Create a Supabase project. Run `web/supabase/schema.sql` in the SQL editor (idempotent; it also upgrades a v1 database and maps the old `submitted` status to `applied`). Create a private Storage bucket named `resumes`.
2. Copy `web/.env.example` to `web/.env.local` and fill in the keys. Required: Supabase URL/anon/service-role key, an LLM key, `CRON_SECRET`. Optional: `RESEND_API_KEY`, `RAPIDAPI_KEY`, `FEED_COMPANIES_JSON`, Razorpay keys.
3. `cd web && npm install && npm run dev` opens on http://localhost:3000
4. Chrome: open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `extension/`.
5. In the dashboard, copy your **Extension token** and paste it into the extension popup (gear icon) along with the API URL.
6. Deploy `web/` to Vercel with the same env vars. `web/vercel.json` schedules `/api/cron/feed` (00:30 UTC) and `/api/cron/alerts` (01:30 UTC); Vercel sends `Authorization: Bearer $CRON_SECRET`. Set the Razorpay webhook URL to `https://YOUR_DOMAIN/api/billing/webhook`.
7. First feed load: if `feed_jobs` is empty or older than 36 h, `/api/feed` refreshes it inline (needs the service-role key). Or call the cron route once by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/feed`.

## Safety rules (built in)
- The agent never clicks Submit and the server never sends email or messages for the user. Outreach is a `mailto:` link or copy-paste.
- No passwords or cookies are stored. The extension works inside the user's own logged-in browser and only reads the page in front of them (no background crawling of LinkedIn).
- Unknown, salary, and sensitive questions come back as `ask_user` and are highlighted, never guessed.
- Tailoring and rewrites never invent employers, numbers or skills; contact details come from the parsed resume; unknown skills are stripped.
- HR email guesses are always labelled unverified; no SMTP probing.
- Every fill is logged in `applications` as an audit trail.
- A database trigger stops users from changing their own `plan` (previously RLS let a user update it directly).

## Multi-step forms (LinkedIn Easy Apply, Workday)
Click **Fill this page** on each step. The agent fills that step and outlines the Next/Submit button in blue. You click it.

## Known limits (be upfront with users)
- CAPTCHAs, OTPs, and logins are always handled by the user.
- Custom dropdown widgets (div-based comboboxes) may need a site adapter. Add one per ATS in `content.js` as you go.
- LinkedIn prohibits automated activity. Keep the human-click Submit rule and never run in the background. LinkedIn's DOM class names change; `hiringTeam()` in `content.js` falls back to finding the "Meet the hiring team" heading.
- Workable's public API rate-limits aggressively (HTTP 429); the two Workable seeds are unverified.
- The extension token is a Supabase session that expires in about an hour. Before launch, swap it for a long-lived per-user API key.
- Experience detection is regex-based; unusual phrasings fall back to "no requirement stated".

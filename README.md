# ApplyPilot v2

An honest AI job-application copilot for Indian freshers and students. It tailors your resume to each job with edits you can see and approve, shows a live ATS keyword score, writes short cover letters from real facts, searches free job sources, prepares you for interviews, tracks applications on a Kanban board, and fills forms through a Chrome side panel. **You always click Submit.**

It costs ₹0 to host: Vercel Hobby + Supabase free tier + Gemini API free tier + free job APIs. No paid service is required.

## What's inside

| Part | What it does |
|---|---|
| `web/` | Next.js 14 (App Router). Landing page, dashboard (Overview, Profile, Jobs, Tailor, Tracker, Extension, Billing), print route for the PDF, and all API routes. |
| `web/supabase/schema.sql` | Idempotent schema with RLS, column privileges, usage events, API keys. Safe to re-run, and migrates a v1 database. |
| `extension/` | Chrome MV3 extension with a **side panel** (Job · Autofill · Answers). Scripts are injected only when you click; no always-on content script. |

### Features
- **Profile**: upload a PDF → AI parse (pdf-parse + LLM) → fully editable profile: contacts, education, experience, projects, skills, common answers (notice period, relocation, work authorisation…) and an **answer bank** of saved Q&A.
- **Tailor with visible diff**: per-bullet and summary rewrites shown old vs new, each with Accept / Reject / Edit. Rewrites that add numbers not in your profile are dropped; new skills are flagged. A **deterministic client-side ATS score** (JD keyword coverage, no AI call) updates live as you accept edits, with matched/missing chips. **Export** a clean single-column ATS-friendly PDF via `/print/resume` (print CSS + `window.print()`).
- **Cover letters**: under 200 words (enforced server-side), facts only, tone choice, editable, copy and `.txt` download.
- **Jobs**: Adzuna (India, free key) + Remotive + Arbeitnow (no key) + optional JSearch. Normalised, de-duplicated, India-first. Filters: fresher-friendly, remote, location. AI fit score with reasons, gaps and missing keywords; interview prep (8 questions with answer pointers from your profile).
- **Tracker**: Kanban (Saved → Applied → Interview → Offer → Rejected) with native HTML5 drag and drop, notes, follow-up dates, weekly applications and response rate.
- **Extension v2**: detects the job (JSON-LD `JobPosting` → adapters for LinkedIn, Naukri, Internshala, Indeed, Greenhouse, Lever, Workday → generic heuristic), shows the ATS match, and offers Save to tracker, Tailor resume (opens the dashboard), Cover letter and AI fit. Autofill keeps the green/orange/blue highlights; **Save my answers** sends what you typed in orange fields to your answer bank. Answers tab = one-click copy.

### Safety rules (enforced on the server, not just in prompts)
- The agent never returns a submit action and the extension never clicks Submit. It outlines the button in blue.
- Salary/CTC, sensitive or demographic, legal and unknown questions always come back as `ask_user` (orange).
- Password and hidden fields are skipped and never sent to the server.
- Salary and ID-number answers are never saved to the answer bank.
- All page and API text in the extension is rendered with `textContent` (no `innerHTML`).

### Security model
- `profiles`: users can only `UPDATE (profile_json, preferences)`; insert/delete are revoked.
- `subscriptions` (plan): readable by the owner, **writable only by the service role** (server + signed Razorpay webhook).
- `usage_events`: insert/select only via the service role. Quotas are checked server-side per kind, per **IST calendar month**. Deleting tracker cards never changes usage.
- `api_keys`: stores only a sha256 hash and a prefix. Keys are shown once, can be revoked, and can't mint other keys.
- Every API route authenticates a Supabase JWT (dashboard) or `Bearer ap_…` (extension), then queries with the service role **scoped to that user id**.
- Autofill: one application row per job/page (upsert on `user_id, page_key`), so a multi-step form counts as **one** autofill.

---

## Free deployment, step by step

### 1. Supabase (free project)
1. Create a project at <https://supabase.com> (free tier).
2. **SQL Editor** → paste all of `web/supabase/schema.sql` → **Run**. It creates the tables, policies, privileges, triggers and a private `resumes` storage bucket. Running it again is safe.
3. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL (e.g. `https://applypilot.vercel.app`) and add `https://applypilot.vercel.app/dashboard` and `http://localhost:3000/dashboard` to *Redirect URLs*. Email magic links work on the free tier (rate-limited; add custom SMTP later if needed).
4. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.

### 2. Gemini API key (free)
Create a key at <https://aistudio.google.com/apikey>. The default model is `gemini-2.5-flash`. Optional alternatives: `LLM_PROVIDER=groq` with a free key from <https://console.groq.com/keys>, or `LLM_PROVIDER=ollama`.

### 3. Adzuna (optional, recommended for India)
Register at <https://developer.adzuna.com/> for a free `app_id` and `app_key`. Without it, search falls back to Remotive and Arbeitnow, which are mostly remote/global jobs.

### 4. Run locally
```bash
cd web
cp .env.example .env.local   # fill in Supabase + GEMINI_API_KEY (+ Adzuna if you have it)
npm install
npm run dev                   # http://localhost:3000
```

### 5. Deploy on Vercel Hobby (free)
1. Push the repo to GitHub → <https://vercel.com/new> → import it → set **Root Directory** to `web`.
2. Add the variables from `.env.example` (at least the three Supabase values and `GEMINI_API_KEY`).
3. Deploy. The build tolerates missing env vars, so you can add keys later and redeploy.
4. Optional billing: create a Razorpay plan (₹149/month), set the four `RAZORPAY_*` vars, and point a webhook to `https://YOUR_DOMAIN/api/billing/webhook` (events: subscription.activated, charged, resumed, cancelled, halted, completed). If any of the four vars is missing, the upgrade UI is hidden and everyone uses the free quotas.

### 6. Load the extension (free, unpacked)
1. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose the `extension/` folder (Chrome 116+).
2. Click the ApplyPilot icon (or press <kbd>Alt+Shift+A</kbd>). The side panel opens.
3. Dashboard → **Extension** → **Generate key**. In the side panel's ⚙ Settings, paste your app URL and the `ap_…` key, and optionally a resume PDF for auto-attach.
4. Site access: the extension reads a page only when you click its icon on that tab (`activeTab`). If a site is blocked, use **Settings → Site access** to allow job boards or all sites (optional host permissions, still only used on click).

---

## Honest hosting and cost notes
- **Vercel Hobby is for non-commercial use only.** Once you charge money (Pro via Razorpay), either upgrade to Vercel Pro or deploy `web/` to a host whose free plan permits commercial use.
- **Chrome Web Store** publishing needs a one-time **US$5** developer registration fee. Loading unpacked is free.
- **Gemini API free tier**: Google may use prompts and responses to improve its products, and free-tier rate limits apply (the app shows a friendly "wait a minute" message on 429). Use a paid tier or another provider if that matters for your users' data.
- Supabase free projects pause after a period of inactivity, and free auth email has low hourly limits.
- Remotive asks that listings link back to Remotive and credit it as the source. The app shows "via Remotive" and links to the original listing.

## Known limits
- CAPTCHAs, OTPs and logins are always handled by the user.
- Custom div-based dropdowns (some Workday/LinkedIn widgets) may need manual picks; they show up orange.
- Site markup changes over time. Adapters in `extension/detect.js` use several fallback selectors, and JSON-LD plus the generic heuristic cover most other cases.
- LinkedIn prohibits automated activity. ApplyPilot runs only on your click, inside your own browser, and never submits.
- The ATS score measures keyword coverage. It is not a replica of any company's ATS.

## Plans
- **Free**: 30 analyses (fit + interview prep), 15 tailors, 10 cover letters, 50 autofills and 10 resume parses a month. Job search, ATS scoring and the tracker are unlimited. Override with `FREE_*` env vars.
- **Pro** (optional): ₹149/month, unlimited.

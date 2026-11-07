// ApplyPilot Board Auto-Apply runner (v2.4: zero-click daily schedule + website settings; v2.3 runner). Loaded into the service worker by background.js (importScripts), so it
// shares background.js's helpers: api, log, serial, getDaily, getCap, istDay, sleep, rand, hostOf, noHash, Cancelled,
// guard, wait, FATAL, getState (the saved-jobs Auto queue).
//
// "Auto-apply recommended jobs": one click, then for each enabled board in order (Naukri → Internshala → Indeed → Foundit)
// the runner opens the board's own *recommended for you* page inside the user's logged-in Chrome, collects the listings,
// and applies one job at a time in a single background tab, only where the apply flow stays on the board.
// Gates: per-board + overall daily caps (IST), 25–75s random delay between applications, stop at once on CAPTCHA, login
// wall, rate-limit text or an unknown page state; any question it cannot answer confidently → needs_review (never
// submitted) and the question is saved to the answer bank as unanswered. No passwords are stored; nothing runs server-side.
"use strict";

const BCFG = self.AP_BOARDS;
const B_DELAY_MIN = 25_000, B_DELAY_MAX = 75_000;
const B_JOB_MS = 150_000, B_MAX_STEPS = 18, B_CONFIRM_MS = 15_000;
const B_MAX_CANDIDATES = 80, B_MAX_PAGES = 3, B_SCROLLS = 4;
const B_TICK = "ap-board-tick";
const GH_LEVER = /(^|\.)(greenhouse\.io|lever\.co)$/i;

// ───────── state (only this runner writes boardState)
const B_DEFAULT = { running: false, status: "idle", message: "", boards: [], boardIdx: 0, board: "", tabId: null, done: [], current: null,
  applied: 0, review: 0, skipped: 0, lowMatch: 0, queued: 0, scheduled: false, startedAt: 0, nextAt: 0, found: 0 };
async function bGet() { const s = (await chrome.storage.local.get("boardState")).boardState; return { ...B_DEFAULT, ...(s || {}) }; }
const bPatch = (p) => serial(async () => { const s = { ...(await bGet()), ...p }; await chrome.storage.local.set({ boardState: s }); return s; });

// ───────── v2.4 settings from the website (GET /api/auto/settings), cached in storage.serverAuto
async function cachedAuto() { return (await chrome.storage.local.get("serverAuto")).serverAuto || null; }
/** Fetches settings + board status from the server; falls back to the cached copy unless the error is fatal. */
async function fetchAutoSettings() {
  try {
    const j = await api("/api/auto/settings", { method: "GET" });
    const v = { settings: j.settings, board_status: j.board_status || {}, today: j.today || null, fetchedAt: Date.now() };
    await chrome.storage.local.set({ serverAuto: v });
    await bSchedule(v.settings);
    return v.settings;
  } catch (e) {
    const c = await cachedAuto();
    if ((e && FATAL.has(e.status)) || !c) throw e;
    return c.settings;
  }
}
/** Overall board daily cap: the website's daily_cap, else the Auto tab's cap. */
async function bOverallCap() { const c = await cachedAuto(); const n = Number(c && c.settings && c.settings.daily_cap); return Number.isFinite(n) && n >= 1 ? Math.min(200, Math.floor(n)) : getCap(); }

/** Per-board settings: { naukri: { on, cap }, … }. Website settings win; else local storage; else boards.js defaults. */
async function boardSettings() {
  const c = await cachedAuto();
  const saved = (c && c.settings && c.settings.boards) || (await chrome.storage.local.get("boardSettings")).boardSettings || {};
  const out = {};
  for (const id of BCFG.ORDER) {
    const b = BCFG.BOARDS[id], s = saved[id] || {};
    const cap = Number(s.cap);
    out[id] = { on: typeof s.on === "boolean" ? s.on : b.defaultOn, cap: Number.isFinite(cap) && cap >= 1 ? Math.min(100, Math.floor(cap)) : b.defaultCap };
  }
  return out;
}
const bumpBoardDaily = (id) => serial(async () => {
  const d = await getDaily(); d.count += 1; d.boards = { ...(d.boards || {}) }; d.boards[id] = (d.boards[id] || 0) + 1;
  await chrome.storage.local.set({ autoDaily: d }); return d;
});

// ───────── tab + script helpers (own tab; never the saved-queue tab)
async function bExec(tabId, opts) {
  try { return await chrome.scripting.executeScript({ target: { tabId }, ...opts }); }
  catch (e) {
    const m = String((e && e.message) || e);
    if (/cannot access|permission|host|Cannot be scripted|error page/i.test(m)) { const err = new Error("NO_ACCESS"); err.noAccess = true; throw err; }
    throw e;
  }
}
async function bInject(tabId) { await bExec(tabId, { files: ["boards.js", "boardpage.js"] }); }
async function bCall(tabId, fn, args = []) {
  await bInject(tabId);
  const r = await bExec(tabId, { func: (name, a) => (window.__APB && typeof window.__APB[name] === "function" ? window.__APB[name](...a) : null), args: [fn, args] });
  return r && r[0] ? r[0].result : null;
}
async function bWaitLoad(ctx, tabId, ms = 25_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { guard(ctx); const t = await chrome.tabs.get(tabId); if (t.status === "complete") return t; await sleep(400); }
  return chrome.tabs.get(tabId);
}
async function bSettle(ctx, tabId, extra = 1500) { await wait(ctx, 1200); await bWaitLoad(ctx, tabId, 15_000); await wait(ctx, extra); }
async function bTab() {
  const st = await bGet();
  if (st.tabId != null) { try { await chrome.tabs.get(st.tabId); return st.tabId; } catch { /* closed */ } }
  const t = await chrome.tabs.create({ url: "about:blank", active: false });
  await bPatch({ tabId: t.id });
  return t.id;
}
/** Navigate the runner tab, refusing LinkedIn and anything off the board (or its apply hosts). */
async function bGo(ctx, tabId, url, board) {
  const h = hostOf(url);
  if (BCFG.EXCLUDED.test(h)) throw new BoardStop("A LinkedIn link came up. Board Auto-Apply never opens LinkedIn.");
  if (!board.hosts.test(h) && !(board.apply.hosts && board.apply.hosts.test(h))) throw new BoardStop(`Unexpected link off ${board.name} (${h}).`);
  await chrome.tabs.update(tabId, { url });
  await bSettle(ctx, tabId);
}

class BoardStop extends Error {}          // stop the whole run (CAPTCHA, login, rate limit, unknown state)
class BoardSkip extends Error {}          // skip this board, continue with the next one

/** Stop conditions checked on every page. */
async function bCheck(ctx, tabId, board, where) {
  guard(ctx);
  const t = await chrome.tabs.get(tabId);
  const h = hostOf(t.url);
  if (BCFG.EXCLUDED.test(h)) throw new BoardStop("Redirected to LinkedIn. Stopped: LinkedIn is never automated.");
  if (board.loginUrl.test(h + new URL(t.url).pathname)) throw new BoardStop(`${board.name} asked you to sign in. Sign in to ${board.name} in this Chrome, then press Auto-apply again.`);
  const s = await bCall(tabId, "state", [board.id]);
  if (!s) throw new BoardStop(`Could not read the ${board.name} page (${where}).`);
  if (s.captcha) throw new BoardStop(`${board.name} showed a CAPTCHA. Stopped so you can deal with it yourself.`);
  if (s.rateLimit) throw new BoardStop(`${board.name} showed a limit message ("${s.rateText.slice(0, 80)}"). Stopped for today's safety.`);
  if (s.login) throw new BoardStop(`${board.name} looks signed out (login wall). Sign in to ${board.name} in this Chrome, then press Auto-apply again.`);
  return s;
}

// ───────── v2.4 board connection status
async function postStatus(list) {
  if (!list.length) return;
  try {
    const r = await api("/api/auto/board", { body: { action: "status", boards: list } });
    const c = (await cachedAuto()) || {};
    await chrome.storage.local.set({ serverAuto: { ...c, board_status: r.board_status || c.board_status || {} } });
  } catch (e) { if (e && FATAL.has(e.status) && e.status !== 429) throw e; }
}
/** Before a run: open the board's recommended page in the runner tab and reuse the login-wall detection. true | false | null. */
async function bConnCheck(ctx, tabId, board) {
  await bGo(ctx, tabId, board.recommended[0], board);
  const t = await chrome.tabs.get(tabId); const h = hostOf(t.url);
  if (BCFG.EXCLUDED.test(h)) throw new BoardStop("Redirected to LinkedIn. Stopped: LinkedIn is never automated.");
  let path = ""; try { path = new URL(t.url).pathname; } catch { /* about:blank */ }
  if (board.loginUrl.test(h + path)) return false;
  if (!board.hosts.test(h)) return /login|signin|auth/i.test(t.url) ? false : null;
  const s = await bCall(tabId, "state", [board.id]);
  if (!s) return null;
  if (s.captcha) throw new BoardStop(`${board.name} showed a CAPTCHA. Stopped so you can deal with it yourself.`);
  return !s.login;
}
/** Lightweight check without opening tabs: fetch the recommended page with the user's cookies (host permissions) and
 *  look for a redirect to a login URL or a password field. Indeed's home page never redirects, so it is only checked in a tab. */
async function bLightCheck() {
  const out = [];
  for (const id of BCFG.ORDER) {
    const b = BCFG.BOARDS[id]; if (id === "indeed") continue;
    let connected = null;
    try {
      const r = await fetch(b.recommended[0], { credentials: "include", redirect: "follow", cache: "no-store" });
      let h = "", p = ""; try { const u = new URL(r.url); h = u.hostname; p = u.pathname; } catch { /* opaque */ }
      if (b.loginUrl.test(h + p)) connected = false;
      else if (r.ok && b.hosts.test(h)) { const html = (await r.text()).slice(0, 200000); connected = !/<input[^>]+type=["']?password/i.test(html); }
    } catch { connected = null; }
    if (connected !== null) out.push({ board: id, connected, checked_at: new Date().toISOString() });
  }
  await postStatus(out);
  await chrome.storage.local.set({ boardLightAt: Date.now() });
  return out;
}

// ───────── tracker
const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const urlKey = (u) => { try { const x = new URL(u); const jk = x.searchParams.get("jk"); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${jk ? `?jk=${jk}` : ""}`.toLowerCase(); } catch { return String(u || "").toLowerCase(); } };
async function trackerLog(board, job, status, note) {
  try {
    const r = await api("/api/auto/board", { body: { action: "log", board: board.id, url: job.url, title: job.title, company: job.company, status, note } });
    return r;
  } catch (e) {
    if (e && FATAL.has(e.status)) throw e;
    await log("error", `${board.name}: could not update the tracker for ${jLabel(job)}: ${e.message}`);
    return null;
  }
}
const jLabel = (j) => [j.company, j.title].filter(Boolean).join(" · ") || j.url;

// ───────── answering screening questions (profile + answer bank; LLM only for short "why you" essays)
const qk = (q) => String(q || "").toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (q) => new Set(qk(q).split(" ").filter((w) => w.length > 2 && !/^(the|you|your|are|what|how|for|and|with|have|this|that|any|our|will)$/.test(w)));
function bankLookup(profile, label) {
  const k = qk(label); const bank = (profile.answer_bank || []).filter((x) => x.a);
  const exact = bank.find((x) => qk(x.q) === k); if (exact) return exact.a;
  const t = tokens(label); if (t.size < 2) return "";
  let best = "", score = 0;
  for (const x of bank) { const u = tokens(x.q); if (!u.size) continue; let inter = 0; for (const w of t) if (u.has(w)) inter++; const j = inter / (t.size + u.size - inter); if (j > score) { score = j; best = x.a; } }
  return score >= 0.75 ? best : "";
}
const yesNo = (v) => /^\s*(yes|y|sure|ok|okay|willing|open|absolutely|available|immediate)/i.test(v) ? "Yes" : /^\s*(no|n|not)\b/i.test(v) ? "No" : "";
function pickOption(options, wants) {
  const L = options.map((o) => String(o).toLowerCase().trim());
  for (const w of wants) {
    if (w instanceof RegExp) { const k = L.findIndex((o) => w.test(o)); if (k >= 0) return options[k]; }
    else if (w) { const s = String(w).toLowerCase().trim(); let k = L.findIndex((o) => o === s); if (k < 0) k = L.findIndex((o) => o.startsWith(s) || (s.length > 3 && o.includes(s))); if (k >= 0) return options[k]; }
  }
  return "";
}
const lakhs = (v) => { const m = String(v || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(l|lpa|lakh|lakhs|lac)?\b/i); if (!m) return null; const n = parseFloat(m[1]); if (m[2]) return n; if (n >= 10000) return n / 100000; return n <= 100 ? n : null; };

/**
 * Returns { value } (string or array), { llm: true } for a short essay, or { unknown: reason }.
 * Rules from the brief: experience = 0 / fresher; notice = immediate; expected CTC from profile or answer bank;
 * location and relocation from profile. Anything else must come from the profile or the answer bank.
 */
function resolveAnswer(q, profile) {
  const label = q.label || ""; const L = label.toLowerCase(); const opts = q.options || [];
  const A = profile.answers || {}; const edu = (profile.education || [])[0] || {};
  const exp = Number(profile.total_experience_years) || 0;
  const choose = (wants, fallbackText) => {
    if (opts.length) { const o = pickOption(opts, wants); return o ? { value: q.kind === "multi" ? [o] : o } : { unknown: "no matching option" }; }
    return fallbackText != null && fallbackText !== "" ? { value: String(fallbackText) } : { unknown: "not in your profile" };
  };
  if (!label.trim()) return { unknown: "question has no label" };

  // 1) The user's own answer bank wins whenever it has this question.
  const bank = bankLookup(profile, label);
  if (bank) { if (opts.length) { const o = pickOption(opts, [bank, yesNo(bank)]); return o ? { value: q.kind === "multi" ? [o] : o } : { unknown: "saved answer matches no option" }; } return { value: bank }; }

  if (q.kind === "file") return q.current ? { skip: true } : { value: "__resume__" };

  // 2) Fixed fresher rules.
  if (/(years?|yrs?)\b.*(experience|exp\b)|experience.*(years?|yrs?)|total (work )?experience|how much experience|relevant experience|work experience/.test(L) && !/(describe|explain|tell us)/.test(L)) {
    if (exp > 0) return choose([String(exp)], String(exp));
    return choose([/^0\b/, /fresher/, /^less than 1/, /^0\s*-\s*1/, /^no experience/, /^none/, /^no$/], "0");
  }
  if (/notice period|how soon can you join|when can you join|joining time|days to join|serving notice/.test(L)) {
    const v = A.notice_period || "Immediate";
    if (q.kind === "number") return { value: "0" };
    return choose([/immediate/, /^0\b/, /15 days or less|less than 15|within 15|^15 days/, v], v);
  }
  if (/(available|ready|able) to (join|start) immediately|immediate joiner|join immediately|start immediately/.test(L)) {
    if (/immediate|^0|yes/i.test(A.notice_period || "Immediate")) return choose([/^yes/, /immediately/, /available/], "Yes");
    return { unknown: "availability not in your profile" };
  }
  if (/availab/.test(L) && opts.length && /yes/i.test(opts.join(" ")) && /immediate|^0|yes/i.test(A.notice_period || "Immediate")) return choose([/^yes.*immediately/, /^yes/], "Yes");
  if (/expected (ctc|salary|stipend|compensation|package)|salary expectation|expected pay|desired (salary|pay)|expected annual/.test(L)) {
    const v = A.expected_ctc || bankLookup(profile, "expected ctc") || bankLookup(profile, "expected salary");
    if (!v) return { unknown: "expected CTC not in your profile or answer bank" };
    if (q.kind === "number") { const l = lakhs(v); if (l == null) return { unknown: "expected CTC is not a number" }; return { value: /lakh|lpa|lac/.test(L) ? String(l) : /month/.test(L) ? String(Math.round((l * 100000) / 12)) : /inr|rupees|per annum|annual|\(₹\)|rs\.?/.test(L) ? String(Math.round(l * 100000)) : String(l) }; }
    return choose([v], v);
  }
  if (/current (ctc|salary|compensation|package)|present (ctc|salary)/.test(L)) {
    const v = A.current_ctc || (exp === 0 ? "0" : "");
    if (!v) return { unknown: "current CTC not in your profile" };
    if (q.kind === "number") { const l = lakhs(v); return l == null ? { unknown: "current CTC is not a number" } : { value: String(/inr|rupees|annum|annual/.test(L) ? Math.round(l * 100000) : l) }; }
    return choose([/^0\b/, /fresher|not applicable|n\/a|none/, v], v);
  }
  if (/relocat|willing to (move|shift|work from|work in)|comfortable (working|to work) (from|in|at)|open to (work|working) (from|in)|ok(ay)? with (the )?location/.test(L)) {
    const yn = yesNo(A.willing_to_relocate || "");
    if (!yn) return { unknown: "relocation answer not in your profile" };
    return choose([new RegExp(`^${yn.toLowerCase()}`)], yn);
  }
  if (/current (location|city)|where are you (currently )?(located|based)|^location$|^city$|your location|residing/.test(L)) {
    if (!profile.location) return { unknown: "location not in your profile" };
    return choose([profile.location.split(",")[0], profile.location], profile.location);
  }
  if (/preferred (job )?location|preferred city/.test(L) && A.preferred_locations) return choose(A.preferred_locations.split(",").map((s) => s.trim()), A.preferred_locations);
  if (/(available|start) (from|date)|date of joining|start date|when can you start/.test(L) && A.available_from) return choose([A.available_from], A.available_from);
  if (/(graduation|passing|passout|pass out|batch) year|year of (graduation|passing)/.test(L)) { const y = A.graduation_year || (String(edu.end || "").match(/\d{4}/) || [])[0]; return y ? choose([y], y) : { unknown: "graduation year not in your profile" }; }
  if (/cgpa|gpa|percentage|aggregate|marks/.test(L) && edu.grade) return choose([edu.grade], edu.grade);
  if (/highest (qualification|education|degree)|qualification|^degree/.test(L) && edu.degree) return choose([edu.degree, [edu.degree, edu.field].filter(Boolean).join(" ")], [edu.degree, edu.field].filter(Boolean).join(", "));
  if (/college|university|institute/.test(L) && edu.institution) return choose([edu.institution], edu.institution);
  if (/work authori|authorized to work|legally (allowed|eligible) to work|require (visa )?sponsorship/.test(L) && A.work_authorization_india) {
    if (/sponsor/.test(L)) return choose([/^no/], "No");
    return choose([/^yes/], A.work_authorization_india);
  }
  if (/languages?/.test(L) && A.languages && !/programming/.test(L)) return choose(A.languages.split(",").map((s) => s.trim()), A.languages);
  if (/^(full )?name|first name|last name|your name/.test(L) && profile.full_name) { const parts = profile.full_name.split(/\s+/); return { value: /first/.test(L) ? parts[0] : /last|surname/.test(L) ? parts.slice(1).join(" ") || parts[0] : profile.full_name }; }
  if (/e-?mail/.test(L) && profile.email) return { value: profile.email };
  if (/phone|mobile|contact number|whatsapp/.test(L) && profile.phone) return { value: profile.phone };
  if (/linkedin/.test(L) && profile.linkedin) return { value: profile.linkedin };
  if (/github/.test(L) && profile.github) return { value: profile.github };
  if (/portfolio|website|personal site/.test(L) && (profile.portfolio || profile.github)) return { value: profile.portfolio || profile.github };
  // Short essays → the server LLM (≤120 words, profile facts only).
  if ((q.kind === "textarea" || q.kind === "text") && /cover letter|why should (we|you) (hire|be hired)|why (do you want|are you interested|are you a good fit|this (role|internship|job))|tell us about yourself|about yourself|what makes you|why should we select/.test(L)) return { llm: true };
  // Optional checkbox we do not understand: leave it alone; required consent/declarations go to the user.
  if (q.kind === "checkbox" && !q.required) return { skip: true };
  return { unknown: "not in your profile or answer bank" };
}

// ───────── one job
async function bApplyJob(ctx, tabId, board, job, profile, opts) {
  await bGo(ctx, tabId, job.url, board);
  await bCheck(ctx, tabId, board, "job page");
  let info = await bCall(tabId, "jobInfo", [board.id]);
  if (!info) return { outcome: "unknown", reason: "Could not read the job page." };
  job.title = job.title || info.title; job.company = job.company || info.company;
  if (info.applied) return { outcome: "skip", reason: "Already applied (board says Applied)." };
  if (info.kind === "external") {
    const h = hostOf(info.href || "");
    if (info.href && GH_LEVER.test(h)) return { outcome: "queue", reason: `Apply link goes to ${h}`, href: info.href };
    return { outcome: "skip", reason: `Apply happens on the company site${h ? ` (${h})` : ""}; skipped.` };
  }
  if (info.kind !== "onboard") return { outcome: "skip", reason: "No on-board Apply button (closed, expired or external)." };

  if (opts.fitCheck && (info.description || "").length > 80) {
    try {
      const s = await api("/api/score", { body: { title: info.title || job.title, description: info.description } });
      if (s.score < opts.minScore) return { outcome: "skip", lowMatch: true, reason: `Match ${s.score}% is below your ${opts.minScore}% minimum.` };
      job.score = s.score;
    } catch (e) { if (e && FATAL.has(e.status)) throw e; /* scoring is optional */ }
  }
  await api("/api/auto/board", { body: { action: "precheck" } }); // 402 when this month's autofills are used up (fatal)
  guard(ctx);

  // Click Apply. A new tab opened by the board is pulled back into the runner tab (one tab at a time).
  const before = new Set((await chrome.tabs.query({})).map((t) => t.id));
  const click = await bCall(tabId, "clickApply", [board.id]);
  if (!click || !click.clicked) return { outcome: "skip", reason: "Apply button disappeared." };
  ctx.clicked = true;
  await bSettle(ctx, tabId, 2000);
  const spawned = (await chrome.tabs.query({})).filter((t) => !before.has(t.id) && t.openerTabId === tabId);
  for (const t of spawned) {
    const u = t.pendingUrl || t.url || "";
    try { await chrome.tabs.remove(t.id); } catch { /* gone */ }
    const h = hostOf(u);
    if (BCFG.EXCLUDED.test(h)) return { outcome: "review", reason: "Apply opened LinkedIn, which is never automated." };
    if (!board.apply.hosts.test(h) && !board.hosts.test(h)) return GH_LEVER.test(h) ? { outcome: "queue", reason: `Apply opened ${h}`, href: u } : { outcome: "skip", reason: `Apply opened an external site (${h}); skipped.` };
    await bGo(ctx, tabId, u, board);
  }
  const cur = await chrome.tabs.get(tabId);
  const ch = hostOf(cur.url);
  if (!board.hosts.test(ch) && !board.apply.hosts.test(ch)) {
    if (BCFG.EXCLUDED.test(ch)) throw new BoardStop("Redirected to LinkedIn. Stopped.");
    return GH_LEVER.test(ch) ? { outcome: "queue", reason: `Apply went to ${ch}`, href: cur.url } : { outcome: "skip", reason: `Apply went to an external site (${ch}); skipped.`, leftBoard: true };
  }
  return bFormLoop(ctx, tabId, board, job, profile, info);
}

async function bFormLoop(ctx, tabId, board, job, profile, info) {
  let unknownStreak = 0, lastSig = "", same = 0, chatAnswered = 0;
  for (let step = 0; step < B_MAX_STEPS; step++) {
    guard(ctx);
    if (Date.now() > ctx.deadline) return { outcome: "review", reason: ctx.submitClicked ? "Time limit hit right after Submit. Check whether it went through." : "Time limit (150s) hit before Submit; nothing was submitted." };
    const s = await bCheck(ctx, tabId, board, "application");
    if (s.success) return { outcome: "applied", reason: "Board confirmed the application." };
    const ji = await bCall(tabId, "jobInfo", [board.id]);
    if (ji && ji.applied && (ctx.clicked || chatAnswered)) return { outcome: "applied", reason: "Button changed to Applied." };

    const qs = (await bCall(tabId, "questions", [board.id])) || { mode: "none", questions: [] };
    const st = await bCall(tabId, "step", [board.id, "find"]);
    if (qs.mode === "none" && !(st && st.kind)) {
      if (++unknownStreak >= 3) return { outcome: "unknown", reason: "Unknown page state after clicking Apply (no form, no confirmation)." };
      await wait(ctx, 2000); continue;
    }
    unknownStreak = 0;

    // Answer this step.
    const todo = qs.questions.filter((q) => !(q.current && q.kind !== "textarea") || (q.kind === "textarea" && !q.current));
    const answers = [], unknown = [];
    for (const q of todo) {
      if (q.kind === "checkbox" && q.current) continue;
      const r = resolveAnswer(q, profile);
      if (r.skip) continue;
      if (r.unknown) { if (q.required || qs.mode === "chat" || /\*/.test(q.label) || !/optional/i.test(q.label)) unknown.push({ q, why: r.unknown }); continue; }
      if (r.llm) {
        try {
          const a = await api("/api/auto/board", { body: { action: "answer", question: q.label, job: { title: info.title || job.title, company: info.company || job.company, description: (info.description || "").slice(0, 5000) } } });
          const text = String(a.answer || "").trim();
          if (!text) { unknown.push({ q, why: "the AI had no answer" }); continue; }
          answers.push({ id: q.id, value: q.maxLength ? text.slice(0, q.maxLength) : text });
        } catch (e) { if (e && FATAL.has(e.status) && e.status !== 429) throw e; unknown.push({ q, why: `AI answer failed (${e.message})` }); }
        continue;
      }
      answers.push({ id: q.id, value: r.value === "__resume__" ? "resume" : r.value });
    }
    if (unknown.length) {
      const labels = unknown.map((u) => u.q.label).filter(Boolean);
      if (labels.length) api("/api/auto/board", { body: { action: "unanswered", questions: labels.slice(0, 10) } }).catch(() => {});
      return { outcome: "review", reason: `Needs your answer: ${labels.slice(0, 3).map((l) => `"${l.slice(0, 90)}"`).join("; ")}${labels.length > 3 ? ` (+${labels.length - 3} more)` : ""}. Saved to your answer bank as unanswered; fill it once.` };
    }
    if (answers.length) {
      const f = await bCall(tabId, "fill", [board.id, answers]);
      if (f && f.failed && f.failed.length) {
        const labels = qs.questions.filter((q) => f.failed.includes(q.id)).map((q) => q.label);
        return { outcome: "review", reason: `Could not fill: ${labels.slice(0, 3).join("; ") || "a field"}. Nothing was submitted.` };
      }
      await wait(ctx, 900);
    }

    if (qs.mode === "chat") {
      // Naukri-style chatbot: one question at a time; the board submits after the last answer.
      const sig = `${qs.questions[0].label}|${qs.questions[0].options.join(",")}`;
      if (sig === lastSig) { if (++same >= 2) return { outcome: "review", reason: `Stuck on the question "${qs.questions[0].label.slice(0, 90)}".` }; } else same = 0;
      lastSig = sig;
      if (!answers.length) return { outcome: "review", reason: "Chat question with nothing to answer." };
      const sent = await bCall(tabId, "chatSend", [board.id]);
      if (!sent && qs.questions[0].kind === "text") return { outcome: "review", reason: "Could not find the chat Save/Send button." };
      chatAnswered++; ctx.submitClicked = true; // the last answer may submit the application
      await patchBoardCurrent({ step: "answering" });
      await wait(ctx, 2500);
      continue;
    }

    const au = await bCall(tabId, "audit", [board.id]);
    if (au && au.missing && au.missing.length) return { outcome: "review", reason: `Required fields still empty: ${au.missing.slice(0, 3).join("; ")}.` };
    if (au && au.errors && au.errors.length && step > 0) return { outcome: "review", reason: `The board flagged: ${au.errors.slice(0, 2).join("; ")}.` };
    const btn = await bCall(tabId, "step", [board.id, "find"]);
    if (!btn || !btn.kind) {
      if (++unknownStreak >= 3) return { outcome: "unknown", reason: "No Next or Submit button on the application step." };
      await wait(ctx, 1500); continue;
    }
    const sig = `${s.url}|${qs.questions.map((q) => q.label).join("|")}|${btn.label}`;
    if (sig === lastSig) { if (++same >= 2) return { outcome: "review", reason: `Stuck on the same step after "${btn.label}" (validation error?).` }; } else same = 0;
    lastSig = sig;
    if (btn.kind === "next") { await bCall(tabId, "step", [board.id, "next"]); await bSettle(ctx, tabId, 1500); continue; }

    // Final gate, re-checked right before Submit.
    await bCheck(ctx, tabId, board, "before submit");
    if (ctx.deadline - Date.now() < B_CONFIRM_MS + 2000) return { outcome: "review", reason: "Ran out of time before Submit; everything was filled but nothing was submitted." };
    const url0 = noHash((await chrome.tabs.get(tabId)).url);
    await patchBoardCurrent({ step: "submitting" });
    ctx.submitClicked = true;
    await bCall(tabId, "step", [board.id, "submit"]);
    const end = Date.now() + B_CONFIRM_MS;
    while (Date.now() < end) {
      await sleep(1200);
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status !== "complete") continue;
        const s2 = await bCall(tabId, "state", [board.id]);
        if (s2 && s2.captcha) throw new BoardStop(`${board.name} showed a CAPTCHA after Submit.`);
        if (s2 && s2.rateLimit) throw new BoardStop(`${board.name} showed a limit message after Submit.`);
        if (s2 && s2.success) return { outcome: "applied", reason: "Board confirmed the application." };
        const j2 = await bCall(tabId, "jobInfo", [board.id]);
        if (j2 && j2.applied) return { outcome: "applied", reason: "Button changed to Applied." };
        if (noHash(t.url) !== url0) { const q2 = await bCall(tabId, "questions", [board.id]); if (q2 && q2.mode === "none") return { outcome: "applied", reason: "Form closed and page changed after Submit." }; break; }
      } catch (e) { if (e instanceof BoardStop) throw e; /* mid-navigation */ }
    }
    // Page moved on to another step (some boards label intermediate buttons "Submit") → keep going.
    const again = await bCall(tabId, "questions", [board.id]);
    if (again && again.mode !== "none" && step + 1 < B_MAX_STEPS) continue;
    return { outcome: "review", reason: "Clicked Submit but saw no confirmation within 15s. Check whether it went through." };
  }
  return { outcome: "review", reason: `More than ${B_MAX_STEPS} steps; nothing more was clicked.` };
}

const patchBoardCurrent = (p) => serial(async () => { const s = await bGet(); if (!s.current) return s; s.current = { ...s.current, ...p }; await chrome.storage.local.set({ boardState: s }); return s; });

// v2.4.1: website roles/locations filters (profiles.auto_settings.roles / .locations). Empty list = no filter.
const fNorm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ");
const fLoc = (l) => (l === "remote" ? /remote|work from home|wfh/ : null);
function bFilter(j, f) {
  const hay = fNorm(`${j.title || ""} ${j.text || ""}`);
  if (f.roles.length && !f.roles.some((r) => hay.includes(r))) return false;
  if (f.locations.length && !f.locations.some((l) => (fLoc(l) ? fLoc(l).test(hay) : hay.includes(l)))) return false;
  return true;
}

// ───────── board: collect recommended listings, then apply one by one
async function bCollect(ctx, tabId, board, known, doneSet, filt = { roles: [], locations: [] }) {
  const cands = [], seen = new Set();
  let skippedApplied = 0, skippedKnown = 0, ineligible = 0, offFilter = 0;
  const take = (jobs) => {
    for (const j of jobs || []) {
      const k = urlKey(j.url); if (!k || seen.has(k)) continue; seen.add(k);
      if (BCFG.EXCLUDED.test(hostOf(j.url)) || !board.hosts.test(hostOf(j.url))) continue;
      if (doneSet.has(k)) continue;
      if (j.applied) { skippedApplied++; continue; }
      if (known.urls.has(k) || (j.company && j.title && known.keys.has(`${normKey(j.company)}|${normKey(j.title)}`))) { skippedKnown++; continue; }
      if (!j.eligible) { ineligible++; continue; }
      if (!bFilter(j, filt)) { offFilter++; continue; }
      cands.push(j);
    }
  };
  const harvest = async () => {
    for (let p = 0; p < B_MAX_PAGES && cands.length < B_MAX_CANDIDATES; p++) {
      for (let s = 0; s < B_SCROLLS; s++) { await bCall(tabId, "scrollMore", []); await wait(ctx, 1200); }
      const r = await bCall(tabId, "listJobs", [board.id]);
      take(r && r.jobs);
      const np = await bCall(tabId, "nextPage", [board.id]);
      if (!np || !np.found) break;
      if (np.href) await bGo(ctx, tabId, np.href, board); else { await bCall(tabId, "clickNext", [board.id]); await bSettle(ctx, tabId); }
      await bCheck(ctx, tabId, board, "next page");
    }
  };
  for (const url of board.recommended) {
    await bGo(ctx, tabId, url, board);
    await bCheck(ctx, tabId, board, "recommended page");
    const landed = (await chrome.tabs.get(tabId)).url;
    if (!board.hosts.test(hostOf(landed))) throw new BoardSkip(`${board.name} redirected away from its recommended page.`);
    await harvest();
    const tabs = await bCall(tabId, "tabs", [board.id]);
    for (const label of tabs || []) {
      if (cands.length >= B_MAX_CANDIDATES) break;
      await bGo(ctx, tabId, url, board);
      if (!(await bCall(tabId, "clickTab", [board.id, label]))) continue;
      await bSettle(ctx, tabId);
      await bCheck(ctx, tabId, board, `tab ${label}`);
      await harvest();
    }
  }
  return { cands, skippedApplied, skippedKnown, ineligible, offFilter };
}

let boardRunner = null, boardCtx = null, keepAlive = null;
function bKick() {
  if (boardRunner) return;
  boardRunner = boardLoop().catch((e) => log("error", `Board Auto-Apply error: ${e && e.message || e}`)).finally(() => { boardRunner = null; });
}

async function boardLoop() {
  const ctx = { cancelled: false }; boardCtx = ctx;
  keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20_000); // keeps the worker awake during delays
  try {
    let st = await bGet(); if (!st.running) return;
    const profile = (await api("/api/profile", { method: "GET" })).profile || {};
    const k = await api("/api/auto/board", { method: "GET" });
    const known = { urls: new Set((k.urls || []).map(urlKey)), keys: new Set(k.keys || []) };
    const srv = await fetchAutoSettings();
    const minScore = Math.max(0, Math.min(100, Number(srv && srv.min_match) || 0));
    const list = (v) => (Array.isArray(v) ? v.map(fNorm).map((x) => x.trim()).filter(Boolean).slice(0, 10) : []);
    const filt = { roles: list(srv && srv.roles), locations: list(srv && srv.locations) };
    if (filt.roles.length || filt.locations.length) await log("info", `Filters: ${filt.roles.length ? `roles ${filt.roles.join(", ")}` : "any role"}; ${filt.locations.length ? `locations ${filt.locations.join(", ")}` : "any location"}.`);
    const fitCheck = minScore > 0; // deterministic ATS keyword score (/api/score): no AI call, no quota
    const tabId = await bTab();

    for (let i = st.boardIdx; i < st.boards.length; i++) {
      st = await bGet(); if (!st.running) return;
      const board = BCFG.BOARDS[st.boards[i]];
      await bPatch({ boardIdx: i, board: board.id, status: "collecting", message: `Opening ${board.name} recommended jobs…`, current: null });
      const settings = await boardSettings();
      const cap = settings[board.id].cap;
      let daily = await getDaily();
      if (((daily.boards || {})[board.id] || 0) >= cap) { await log("info", `${board.name}: today's cap reached (${cap}). Next board.`); continue; }
      // v2.4: is the user signed in to this board? Report it; skip the board (not the run) when signed out.
      let conn = null;
      try { conn = await bConnCheck(ctx, tabId, board); }
      catch (e) { if (e instanceof BoardStop || e instanceof Cancelled || (e && e.noAccess)) throw e; conn = null; }
      await postStatus(conn === null ? [] : [{ board: board.id, connected: conn, checked_at: new Date().toISOString() }]);
      if (conn === false) { await log("warn", `${board.name}: not signed in. Sign in to ${board.name} in this Chrome; skipped today.`); continue; }
      const doneSet = new Set((st.done || []).map(urlKey));
      let col;
      try { col = await bCollect(ctx, tabId, board, known, doneSet, filt); }
      catch (e) { if (e instanceof BoardSkip) { await log("warn", e.message); continue; } throw e; }
      await bPatch({ found: (await bGet()).found + col.cands.length });
      await log(col.cands.length ? "ok" : "info", `${board.name}: ${col.cands.length} recommended job${col.cands.length === 1 ? "" : "s"} to try (${col.skippedApplied} already applied on ${board.name}, ${col.skippedKnown} already in your tracker${col.ineligible ? `, ${col.ineligible} without on-board apply` : ""}${col.offFilter ? `, ${col.offFilter} outside your roles/locations` : ""}).`);

      for (const job of col.cands) {
        st = await bGet(); if (!st.running) return;
        daily = await getDaily();
        const overall = await bOverallCap();
        if (daily.count >= overall) return bStop(`Daily cap reached (${daily.count}/${overall}). Resets at midnight IST.`);
        if (((daily.boards || {})[board.id] || 0) >= cap) { await log("info", `${board.name}: today's cap reached (${cap}).`); break; }
        if (st.nextAt && Date.now() < st.nextAt) { await bPatch({ status: "waiting", message: `Next application in ${Math.round((st.nextAt - Date.now()) / 1000)}s` }); await wait(ctx, st.nextAt - Date.now()); }
        await bPatch({ status: "running", message: "", nextAt: 0, current: { board: board.id, url: job.url, title: job.title, company: job.company, step: "working", startedAt: Date.now() } });
        await log("info", `${board.name}: opening ${jLabel(job)}`);
        const jctx = { cancelled: false, deadline: Date.now() + B_JOB_MS, clicked: false, submitClicked: false };
        const onStop = setInterval(() => { if (ctx.cancelled) { jctx.cancelled = true; jctx.cancelReason = ctx.cancelReason; } }, 300);
        let res, stopMsg = "";
        try { res = await bApplyJob(jctx, tabId, board, job, profile, { fitCheck, minScore }); }
        catch (e) {
          if (e instanceof BoardStop) { stopMsg = e.message; res = { outcome: jctx.clicked ? "review" : "none", reason: `Stopped: ${e.message}` }; }
          else if (e instanceof Cancelled || jctx.cancelled) res = { outcome: jctx.submitClicked ? "review" : "none", reason: jctx.submitClicked ? "Stopped right after Submit. Check whether it went through." : "Stopped." };
          else if (e && FATAL.has(e.status)) { stopMsg = e.message; res = { outcome: "none", reason: e.message }; }
          else if (e && e.noAccess) { stopMsg = `Chrome would not let ApplyPilot read ${board.name}. Reload the extension or allow site access.`; res = { outcome: "none", reason: stopMsg }; }
          else res = { outcome: jctx.submitClicked ? "review" : "skip", reason: `Unexpected error: ${String(e && e.message || e).slice(0, 160)}` };
        } finally { clearInterval(onStop); }
        if (res.outcome === "unknown") { stopMsg = `${board.name}: ${res.reason} Stopped to be safe.`; res = { outcome: "review", reason: res.reason }; }

        const p = { current: null, done: [...(st.done || []), job.url].slice(-500) };
        if (res.outcome === "applied") {
          await trackerLog(board, job, "applied", `${board.name}: ${res.reason}${job.score != null ? ` Fit ${job.score}%.` : ""}`);
          const d = await bumpBoardDaily(board.id);
          p.applied = st.applied + 1;
          known.urls.add(urlKey(job.url));
          await log("ok", `${board.name}: applied to ${jLabel(job)} (${(d.boards || {})[board.id]}/${cap} on ${board.name}, ${d.count} today).`);
        } else if (res.outcome === "review") {
          await trackerLog(board, job, "needs_review", `${board.name}: ${res.reason}`);
          p.review = st.review + 1;
          await log("warn", `${board.name}: needs review: ${jLabel(job)}: ${res.reason}`);
        } else if (res.outcome === "queue") {
          await trackerLog(board, { ...job, url: res.href }, "saved", `${board.name}: on-board apply not available; added to the Auto queue (${hostOf(res.href)}).`);
          p.queued = st.queued + 1;
          await log("info", `${board.name}: ${jLabel(job)} applies on ${hostOf(res.href)}; added to your Auto queue as Saved.`);
        } else if (res.outcome === "skip") {
          p.skipped = st.skipped + 1;
          if (res.lowMatch) p.lowMatch = (st.lowMatch || 0) + 1;
          await log("info", `${board.name}: skipped ${jLabel(job)}: ${res.reason}`);
        }
        const attempted = jctx.clicked;
        await bPatch(p);
        if (stopMsg) return bStop(stopMsg);
        if (!(await bGet()).running) return;
        const delay = attempted ? rand(B_DELAY_MIN, B_DELAY_MAX) : rand(4000, 9000);
        await bPatch({ nextAt: Date.now() + delay, status: "waiting", message: `Next ${attempted ? "application" : "job"} in ${Math.round(delay / 1000)}s` });
      }
    }
    await bStop("Done: worked through the recommended jobs on every enabled board.");
  } catch (e) {
    if (e instanceof BoardStop) return bStop(e.message);
    if (e instanceof Cancelled || ctx.cancelled) return;
    if (e && e.noAccess) return bStop("Chrome would not let ApplyPilot open the job board. Reload the extension (site access for the boards is part of v2.3).");
    if (e && e.status) return bStop(`Stopped: ${e.message}`);
    if (/No tab with id/i.test(String(e && e.message))) return bStop("The Board Auto-Apply tab was closed.");
    return bStop(`Stopped after an unexpected error: ${String(e && e.message || e).slice(0, 160)}`);
  } finally {
    clearInterval(keepAlive); keepAlive = null;
    if (boardCtx === ctx) boardCtx = null;
  }
}

let bStarting = false;
async function bStart(opts = {}) {
  if (bStarting) return { ok: true, already: true };
  bStarting = true;
  try { return await bStartInner(opts); } finally { bStarting = false; }
}
async function bStartInner(opts) {
  const st = await bGet();
  if (st.running) return { ok: true, already: true };
  const { autoEnabled, api: base, key } = await chrome.storage.local.get(["autoEnabled", "api", "key"]);
  if (!autoEnabled) return { ok: false, retry: true, error: "Turn Auto mode on first." };
  if (!base || !key) return { ok: false, retry: true, error: "Connect your account in Settings first." };
  if ((await getState()).running) return { ok: false, retry: true, error: "The saved-jobs Auto run is going. Stop it first (one tab at a time)." };
  try { await fetchAutoSettings(); } catch (e) { return { ok: false, retry: !(e && FATAL.has(e.status)), error: `Could not load your Auto-apply settings: ${e.message}` }; }
  const settings = await boardSettings();
  const boards = BCFG.ORDER.filter((id) => settings[id].on);
  if (!boards.length) return { ok: false, error: "Turn on at least one job board." };
  const cap = await bOverallCap(), daily = await getDaily();
  if (daily.count >= cap) return { ok: false, error: `Daily cap reached (${daily.count}/${cap}). Resets at midnight IST.` };
  await chrome.storage.session.set({ boardAlive: true });
  await bPatch({ ...B_DEFAULT, tabId: st.tabId, running: true, status: "starting", boards, startedAt: Date.now(), scheduled: !!opts.scheduled });
  await log("info", `Board Auto-Apply started${opts.scheduled ? " (scheduled, no click)" : ""}: ${boards.map((id) => BCFG.BOARDS[id].name).join(" → ")} (recommended jobs only), ${cap - daily.count} left under today's cap.`);
  chrome.alarms.create(B_TICK, { periodInMinutes: 0.5 });
  bKick();
  return { ok: true };
}

async function bStop(message = "Stopped.") {
  if (boardCtx) { boardCtx.cancelled = true; boardCtx.cancelReason = "stop"; }
  await chrome.alarms.clear(B_TICK);
  const st = await bGet();
  if (st.current && st.current.step === "submitting") {
    await trackerLog(BCFG.BOARDS[st.current.board] || { id: st.current.board, name: st.current.board }, st.current, "needs_review", "Stopped right after Submit. Check whether it went through.").catch(() => {});
  }
  await bPatch({ running: false, status: "stopped", message, nextAt: 0, current: null });
  await log("info", `Board Auto-Apply: ${message}`);
  const s2 = await bGet();
  if (s2.tabId != null) { try { await chrome.tabs.remove(s2.tabId); } catch { /* gone */ } await bPatch({ tabId: null }); }
}

// ───────── v2.4 zero-click schedule: daily alarm at run_time (IST) + a 15-min check that also catches up when Chrome
// opened after run_time and today has not run yet. Runs only while Chrome is open; Auto mode (local switch) must be on.
const B_DAILY = "ap-board-daily", B_CHECK = "ap-board-check", LIGHT_EVERY_MS = 6 * 3600_000;
const runAtToday = (hhmm) => Date.parse(`${istDay()}T${/^\d\d:\d\d$/.test(hhmm || "") ? hhmm : "09:00"}:00+05:30`);
async function bSchedule(settings) {
  if (!settings || !settings.enabled) { await chrome.alarms.clear(B_DAILY); return; }
  let when = runAtToday(settings.run_time); if (when <= Date.now()) when += 86_400_000;
  const a = await chrome.alarms.get(B_DAILY);
  if (!a || Math.abs(a.scheduledTime - when) > 60_000) chrome.alarms.create(B_DAILY, { when, periodInMinutes: 1440 });
}
async function ensureCheckAlarm() { if (!(await chrome.alarms.get(B_CHECK))) chrome.alarms.create(B_CHECK, { delayInMinutes: 1, periodInMinutes: 15 }); }
let bScheduling = false;
async function bMaybeScheduled(why) {
  if (bScheduling) return; bScheduling = true;
  try {
    const { api: base, key } = await chrome.storage.local.get(["api", "key"]);
    if (!base || !key) return;
    let s; try { s = await fetchAutoSettings(); } catch { return; }
    await bSchedule(s);
    const { boardLightAt } = await chrome.storage.local.get("boardLightAt");
    if (!boardLightAt || Date.now() - boardLightAt > LIGHT_EVERY_MS) await bLightCheck().catch(() => {});
    if (!s || !s.enabled) return;
    const day = istDay();
    const { boardLastAutoDay } = await chrome.storage.local.get("boardLastAutoDay");
    if (boardLastAutoDay === day || Date.now() < runAtToday(s.run_time)) return;
    const r = await bStart({ scheduled: true });
    if (r.ok) { await chrome.storage.local.set({ boardLastAutoDay: day }); if (!r.already) await log("info", `Scheduled run (${s.run_time} IST${why === "catchup" ? ", catch-up" : ""}).`); }
    else if (!r.retry) { await chrome.storage.local.set({ boardLastAutoDay: day }); await log("warn", `Scheduled run skipped today: ${r.error}`); }
  } finally { bScheduling = false; }
}
chrome.runtime.onStartup.addListener(() => { ensureCheckAlarm(); setTimeout(() => bMaybeScheduled("catchup"), 8000); });
chrome.runtime.onInstalled.addListener(() => { ensureCheckAlarm(); setTimeout(() => bMaybeScheduled("catchup"), 8000); });
ensureCheckAlarm();

// Messages (board:start / board:stop / board:state / board:check / board:settings) are handled in background.js.
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === B_TICK) bGet().then((s) => { if (s.running) bKick(); });
  else if (a.name === B_DAILY) bMaybeScheduled("alarm");
  else if (a.name === B_CHECK) bMaybeScheduled("catchup");
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.autoEnabled && c.autoEnabled.newValue === false) bGet().then((s) => { if (s.running) bStop("Auto mode was turned off."); });
});
chrome.tabs.onRemoved.addListener((tabId) => { bGet().then((s) => { if (s.tabId === tabId) { bPatch({ tabId: null }); if (s.running) bStop("The Board Auto-Apply tab was closed."); } }); });

// Worker woke up mid-run: after a suspension, continue (finished jobs are remembered in boardState.done);
// after a Chrome restart (session storage gone), never resume: stop and let the user press the button again.
bGet().then(async (s) => {
  if (!s.running) return;
  const { boardAlive } = await chrome.storage.session.get("boardAlive");
  if (!boardAlive) { await bPatch({ current: null, tabId: null }); await bStop("Stopped because Chrome restarted. Press Run now to continue."); return; }
  if (s.current && s.current.step === "submitting") {
    await trackerLog(BCFG.BOARDS[s.current.board], s.current, "needs_review", "Interrupted right after Submit. Check whether it went through.").catch(() => {});
    await bPatch({ current: null, done: [...(s.done || []), s.current.url].slice(-500) });
  }
  bKick();
});

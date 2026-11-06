// ApplyPilot service worker.
// 1) Opens the side panel when the toolbar icon is clicked.
// 2) Runs the opt-in Auto mode: works through "saved" tracker jobs one at a time in a background tab, fills them with
//    the same agent as Review mode, and clicks Submit ONLY when every gate passes. Everything else → "needs_review".
// 3) Hands-free discovery (v2.2): when "Find jobs automatically" is on, Auto mode asks the server for fresh matching
//    entry-level jobs (POST /api/auto/discover) when a run starts and whenever the queue runs dry, then keeps going.
// MV3-safe: all progress lives in chrome.storage.local; chrome.alarms wake the worker if Chrome suspends it.
"use strict";

const enablePanel = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);

// ───────────────────────── constants
const JOB_TIMEOUT_MS = 90_000;
const CONFIRM_MS = 15_000;
const MAX_STEPS = 8;
const DELAY_MIN_MS = 20_000, DELAY_MAX_MS = 60_000;
const DEFAULT_CAP = 20;
const LOG_MAX = 150;
const TICK = "ap-auto-tick", NEXT = "ap-auto-next";
const EXCLUDED_HOSTS = /(^|\.)linkedin\.com$/i;
const MAX_DISCOVERY_ROUNDS = 5; // per run: stops a run from searching forever when nothing new turns up

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
/** Calendar day in IST (Asia/Kolkata), e.g. "2026-10-25". The daily cap resets at IST midnight. */
const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const noHash = (u) => String(u || "").replace(/#.*$/, "");

// ───────────────────────── state (service worker is the only writer of autoState / autoLog / autoDaily)
const DEFAULT_STATE = { running: false, status: "idle", message: "", queue: [], total: 0, submitted: 0, skipped: 0, discovered: 0, discoverRounds: 0, discoverDry: false, discoverNote: "", needDiscover: false, current: null, nextAt: 0, tabId: null, startedAt: 0 };
async function getState() { const s = (await chrome.storage.local.get("autoState")).autoState; return { ...DEFAULT_STATE, ...(s || {}) }; }
// Writes are serialised so a Stop click can never be overwritten by a job finishing at the same moment.
let chain = Promise.resolve();
const serial = (fn) => { const r = chain.then(fn); chain = r.catch(() => {}); return r; };
const patch = (p) => serial(async () => { const s = { ...(await getState()), ...p }; await chrome.storage.local.set({ autoState: s }); return s; });
const patchCurrent = (p) => serial(async () => { const s = await getState(); if (!s.current) return s; s.current = { ...s.current, ...p }; await chrome.storage.local.set({ autoState: s }); return s; });
const log = (kind, text) => serial(async () => {
  const l = (await chrome.storage.local.get("autoLog")).autoLog || [];
  l.unshift({ t: Date.now(), kind, text: String(text).slice(0, 400) });
  await chrome.storage.local.set({ autoLog: l.slice(0, LOG_MAX) });
});
async function getDaily() {
  const d = (await chrome.storage.local.get("autoDaily")).autoDaily;
  const day = istDay();
  return d && d.day === day ? { discovered: 0, ...d } : { day, count: 0, discovered: 0 };
}
const bumpDaily = () => serial(async () => { const d = await getDaily(); d.count += 1; await chrome.storage.local.set({ autoDaily: d }); return d; });
const bumpDiscovered = (n) => serial(async () => { const d = await getDaily(); d.discovered = (d.discovered || 0) + n; await chrome.storage.local.set({ autoDaily: d }); return d; });

/** Discovery settings from the Auto tab. "Find jobs automatically" defaults to on. */
async function getDiscoverySettings() {
  const d = await chrome.storage.local.get(["autoDiscover", "autoKeywords", "autoLocation", "autoRemote", "autoMinScore"]);
  const min = Number(d.autoMinScore);
  return {
    on: d.autoDiscover !== false,
    keywords: String(d.autoKeywords || "").slice(0, 300),
    location: String(d.autoLocation || "").slice(0, 200),
    remote: d.autoRemote !== false,
    minScore: Number.isFinite(min) && min >= 0 && min <= 100 ? Math.round(min) : 30
  };
}
async function getCap() { const c = Number((await chrome.storage.local.get("autoCap")).autoCap); return Number.isFinite(c) && c >= 1 ? Math.min(200, Math.floor(c)) : DEFAULT_CAP; }

// ───────────────────────── API (same contract as the side panel)
async function api(path, { method = "POST", body } = {}) {
  const { api: base, key } = await chrome.storage.local.get(["api", "key"]);
  if (!base || !key) { const e = new Error("Connect your account in Settings first."); e.status = 401; throw e; }
  let r;
  try { r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: body ? JSON.stringify(body) : undefined }); }
  catch { const e = new Error("Could not reach the ApplyPilot server."); e.status = 0; throw e; }
  let j = {}; try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return j;
}
// Errors that would hit every job: stop the run instead of skipping the whole queue.
const FATAL = new Set([401, 402, 403, 429, 503]);

// ───────────────────────── tab + script helpers
class Cancelled extends Error {}
function guard(ctx) { if (ctx.cancelled) throw new Cancelled(ctx.cancelReason || "cancelled"); }
async function wait(ctx, ms) { const end = Date.now() + ms; while (Date.now() < end) { guard(ctx); await sleep(Math.min(500, end - Date.now())); } }

async function waitLoad(ctx, tabId, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    guard(ctx);
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return t;
    await sleep(400);
  }
  return chrome.tabs.get(tabId);
}
async function settle(ctx, tabId) { await wait(ctx, 1500); await waitLoad(ctx, tabId, 12_000); await wait(ctx, 1200); }

async function exec(tabId, opts, allFrames = true, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames };
  try { return await chrome.scripting.executeScript({ target, ...opts }); }
  catch (e) {
    if (allFrames && !frameIds) return exec(tabId, opts, false);
    const m = String((e && e.message) || e);
    if (/cannot access|permission|host|Cannot be scripted|error page/i.test(m)) { const err = new Error("NO_ACCESS"); err.noAccess = true; throw err; }
    throw e;
  }
}
const inject = (tabId) => exec(tabId, { files: ["autofill.js"] });
const callAP = (tabId, fn, args = [], frameIds) => exec(tabId, {
  func: (name, a) => (window.__AP && typeof window.__AP[name] === "function" ? window.__AP[name](...a) : null),
  args: [fn, args]
}, true, frameIds);

async function ensureTab(url) {
  const st = await getState();
  if (st.tabId != null) {
    try { await chrome.tabs.get(st.tabId); await chrome.tabs.update(st.tabId, { url }); return st.tabId; } catch { /* closed */ }
  }
  const t = await chrome.tabs.create({ url, active: false });
  await patch({ tabId: t.id });
  return t.id;
}
async function closeTab() {
  const st = await getState();
  if (st.tabId != null) { try { await chrome.tabs.remove(st.tabId); } catch { /* gone */ } await patch({ tabId: null }); }
}
/** Some forms only react when visible. Activate the tab for ~2.5s, then give focus back. Used at most once per job. */
async function focusBriefly(ctx, tabId) {
  if (ctx.focused) return false;
  ctx.focused = true;
  const t = await chrome.tabs.get(tabId);
  const [prev] = await chrome.tabs.query({ active: true, windowId: t.windowId });
  await chrome.tabs.update(tabId, { active: true });
  try { await wait(ctx, 2500); }
  finally { if (prev && prev.id !== tabId) await chrome.tabs.update(prev.id, { active: true }).catch(() => {}); }
  return true;
}

function merge(results) {
  const r = { captcha: false, login: false, success: false, fields: 0, textLen: 0, url: "" };
  for (const f of results || []) {
    const x = f.result; if (!x) continue;
    r.captcha ||= x.captcha; r.success ||= x.success; r.fields += x.fields; r.textLen += x.textLen;
    if (x.top) { r.url = x.url; r.login = x.login; } // login wall judged on the top frame only
  }
  return r;
}
const fingerprint = (i) => `${noHash(i.url)}|${i.fields}|${Math.round(i.textLen / 50)}`;
const list = (xs, n = 3) => { const u = [...new Set(xs.filter(Boolean))]; return u.slice(0, n).join("; ") + (u.length > n ? ` (+${u.length - n} more)` : ""); };

// ───────────────────────── one job
// Returns { outcome: "applied" | "review" | "left", reason }
//  applied → status "applied"; review → status "needs_review" + note; left → unchanged (stays "saved")
async function doJob(app, ctx) {
  if (EXCLUDED_HOSTS.test(hostOf(app.url))) return { outcome: "review", reason: "LinkedIn is excluded from Auto mode (LinkedIn's terms). Apply manually." };
  let origin; try { origin = new URL(app.url).origin; } catch { return { outcome: "review", reason: "Apply URL is not valid." }; }
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] })))
    return { outcome: "left", reason: `No site access for ${hostOf(app.url)}. In the Auto tab, allow all sites.` };

  const tabId = await ensureTab(app.url);
  ctx.tabId = tabId;
  await waitLoad(ctx, tabId);
  await wait(ctx, 1500);

  let lastFp = "", sameCount = 0, entries = 0;
  for (let step = 1; step <= MAX_STEPS; step++) {
    guard(ctx);
    const tab = await chrome.tabs.get(tabId);
    if (EXCLUDED_HOSTS.test(hostOf(tab.url))) return { outcome: "review", reason: "Redirected to LinkedIn, which Auto mode never automates." };
    await inject(tabId);
    let insp = merge(await callAP(tabId, "inspect"));
    if (ctx.clicked && insp.success) return { outcome: "applied", reason: "Confirmation shown" };
    if (ctx.entryPending && insp.fields) { ctx.entryPending = false; ctx.submitClicked = false; await patchCurrent({ step: "working" }); } // it only opened the form
    if (insp.captcha) return { outcome: "review", reason: "CAPTCHA on the page." };
    if (insp.login) return { outcome: "review", reason: "Sign-in or account required." };

    // No form yet: an "Apply" link/button may open it.
    if (!insp.fields) {
      const finds = await callAP(tabId, "act", ["find"]);
      const nextHit = finds.find((f) => f.result && f.result.kind === "next");
      if (nextHit) { ctx.clicked = true; await callAP(tabId, "act", ["next"], [nextHit.frameId]); await settle(ctx, tabId); continue; }
      const hit = finds.find((f) => f.result && f.result.kind === "entry");
      if (hit && entries < 2) {
        entries++; ctx.clicked = true;
        if (hit.result.entryIsLink && hit.result.href) {
          // Follow "Apply" links in the same tab (many open a new tab otherwise).
          const href = hit.result.href;
          if (EXCLUDED_HOSTS.test(hostOf(href))) return { outcome: "review", reason: "Apply link goes to LinkedIn, which Auto mode never automates." };
          let o; try { o = new URL(href).origin; } catch { return { outcome: "review", reason: "Apply link is not valid." }; }
          if (!(await chrome.permissions.contains({ origins: [`${o}/*`] }))) return { outcome: "left", reason: `No site access for ${hostOf(href)}. In the Auto tab, allow all sites.` };
          await chrome.tabs.update(tabId, { url: href });
        } else {
          // A bare "Apply" button with no form can be a one-click apply on some boards: treat it as a submit.
          // All gates hold here: no fields to fill, no ask_user, no CAPTCHA or sign-in wall.
          await patchCurrent({ step: "submitting" });
          ctx.submitClicked = true; ctx.entryPending = true;
          await callAP(tabId, "act", ["entry"], [hit.frameId]);
        }
        await settle(ctx, tabId);
        continue;
      }
      if (await focusBriefly(ctx, tabId)) { step--; continue; }
      return { outcome: "review", reason: "No application form found on the page." };
    }

    // Collect + fill with the same agent as Review mode.
    const frames = await callAP(tabId, "collect");
    const fields = []; let url = tab.url, title = tab.title || "";
    for (const f of frames) { const r = f.result; if (!r) continue; fields.push(...r.fields); if (r.top) { url = r.url; title = r.title; } }
    const byId = new Map(fields.map((f) => [f.id, f]));
    if (fields.length) {
      guard(ctx);
      const res = await api("/api/agent", { body: { url, pageTitle: title, fields: fields.slice(0, 150), jobId: app.job_id || null, applicationId: app.id } });
      guard(ctx);
      const applied = await callAP(tabId, "apply", [res.actions || []]);
      const asks = applied.flatMap((r) => (r.result && r.result.asks) || []);
      if (asks.length) return { outcome: "review", reason: `Needs your answer: ${list(asks.map((a) => `${(byId.get(a.id) || {}).label || "field"} (${a.reason || "needs you"})`))}` };
      await wait(ctx, 900);
    }

    const audit = await callAP(tabId, "audit");
    const missing = audit.flatMap((r) => (r.result && r.result.missing) || []);
    const invalid = audit.flatMap((r) => (r.result && r.result.invalid) || []);
    if (missing.length) return { outcome: "review", reason: `Required fields still empty: ${list(missing)}` };
    if (invalid.length) return { outcome: "review", reason: `Site flagged fields as invalid: ${list(invalid)}` };

    // Which button is next? Prefer the frame that holds the form.
    const finds = (await callAP(tabId, "act", ["find"])).filter((f) => f.result && f.result.kind);
    const pick = finds.find((f) => f.result.kind === "next") || finds.find((f) => f.result.kind === "submit") || finds.find((f) => f.result.kind === "entry");
    if (!pick) {
      if (await focusBriefly(ctx, tabId)) { step--; continue; }
      return { outcome: "review", reason: "No Next or Submit button found." };
    }

    const fp = fingerprint(insp);
    if (fp === lastFp) { if (++sameCount >= 2) return { outcome: "review", reason: `Stuck on the same step after clicking "${pick.result.label}" (validation error?).` }; }
    else sameCount = 0;
    lastFp = fp;

    if (pick.result.kind === "next" || (pick.result.kind === "entry" && entries < 2)) {
      if (pick.result.kind === "entry") entries++;
      ctx.clicked = true;
      await callAP(tabId, "act", [pick.result.kind], [pick.frameId]);
      await settle(ctx, tabId);
      continue;
    }
    if (pick.result.kind !== "submit") return { outcome: "review", reason: "No Submit button found." };

    // ── Final gate, re-checked right before clicking Submit.
    insp = merge(await callAP(tabId, "inspect"));
    if (insp.captcha) return { outcome: "review", reason: "CAPTCHA on the page." };
    if (insp.login) return { outcome: "review", reason: "Sign-in or account required." };
    if (ctx.deadline - Date.now() < CONFIRM_MS + 2000) return { outcome: "review", reason: "Ran out of time before Submit (90s limit). Everything was filled; check and submit yourself." };
    guard(ctx);
    const before = { url: noHash((await chrome.tabs.get(tabId)).url), success: insp.success };
    await patchCurrent({ step: "submitting" });
    ctx.submitClicked = true; ctx.clicked = true;
    await callAP(tabId, "act", ["submit"], [pick.frameId]);
    return confirmSubmit(ctx, tabId, before);
  }
  return { outcome: "review", reason: `More than ${MAX_STEPS} steps.` };
}

/** After Submit: success = URL change or thank-you/submitted/received text within 15s. */
async function confirmSubmit(ctx, tabId, before) {
  const end = Date.now() + CONFIRM_MS;
  while (Date.now() < end) {
    await sleep(1000);
    let t; try { t = await chrome.tabs.get(tabId); } catch { break; }
    if (before.url && noHash(t.url) !== before.url && !EXCLUDED_HOSTS.test(hostOf(t.url))) return { outcome: "applied", reason: "Page changed after Submit" };
    try {
      if (t.status === "complete") { await inject(tabId); const i = merge(await callAP(tabId, "inspect")); if (i.success && !before.success) return { outcome: "applied", reason: "Confirmation shown" }; }
    } catch { /* page mid-navigation */ }
  }
  try {
    const audit = await callAP(tabId, "audit");
    const bad = audit.flatMap((r) => (r.result && [...r.result.missing, ...r.result.invalid]) || []);
    if (bad.length) return { outcome: "review", reason: `Clicked Submit but the site reported problems: ${list(bad)}` };
  } catch { /* ignore */ }
  return { outcome: "review", reason: "Clicked Submit but saw no confirmation within 15s. Check whether it went through." };
}

// ───────────────────────── run loop
let runner = null;
let activeCtx = null;

function kick() {
  if (runner) return;
  runner = loop().catch((e) => log("error", `Auto mode error: ${e && e.message || e}`)).finally(() => { runner = null; });
}

async function loop() {
  for (let guardN = 0; guardN < 500; guardN++) {
    const st = await getState();
    if (!st.running) return;
    if (st.current) { await runCurrent(st); continue; }
    if (st.nextAt && Date.now() < st.nextAt) {
      const ms = st.nextAt - Date.now();
      chrome.alarms.create(NEXT, { when: st.nextAt });
      setTimeout(kick, ms + 50); // whichever fires first (timer or alarm) continues; the other is a no-op
      return;
    }
    if (!(await chrome.storage.local.get("autoEnabled")).autoEnabled) return stopRun("Auto mode was turned off.");
    const cap = await getCap(), daily = await getDaily();
    if (daily.count >= cap) return stopRun(`Daily cap reached (${daily.count}/${cap}). Resets at midnight IST.`);
    if (!st.queue.length || st.needDiscover) {
      const ds = await getDiscoverySettings();
      if (ds.on && !st.discoverDry && st.discoverRounds < MAX_DISCOVERY_ROUNDS) {
        const r = await runDiscovery(ds, cap - daily.count);
        if (r === "fatal") return;
        continue;
      }
      if (st.needDiscover) await patch({ needDiscover: false });
      if (!st.queue.length) return stopRun(ds.on && st.discoverNote ? `Queue finished. ${st.discoverNote}` : ds.on ? (st.discovered ? "Queue finished. No more new matching jobs right now." : "No new matching jobs found. Try broader keywords, another location or a lower min fit score.") : "Queue finished.");
      continue;
    }
    const [app, ...rest] = st.queue;
    await patch({ queue: rest, nextAt: 0, status: "running", current: { app, startedAt: Date.now(), step: "working", attempt: 1 } });
  }
}

async function runCurrent(st) {
  const cur = st.current;
  const elapsed = Date.now() - cur.startedAt;
  const fresh = cur.attempt === 1 && cur.step === "working" && elapsed < 5000;
  let result;
  if (!fresh && cur.step === "submitting") {
    // Worker was suspended right after Submit: check the page once, never click again.
    result = { outcome: "review", reason: "Interrupted right after clicking Submit. Check whether it went through." };
    try { await inject(st.tabId); const i = merge(await callAP(st.tabId, "inspect")); if (i.success) result = { outcome: "applied", reason: "Confirmation shown" }; } catch { /* tab gone */ }
  } else if (!fresh && (cur.attempt >= 2 || elapsed >= JOB_TIMEOUT_MS)) {
    result = { outcome: "review", reason: elapsed >= JOB_TIMEOUT_MS ? "Timed out after 90s." : "Interrupted twice; skipped." };
  } else {
    if (!fresh) { cur.attempt += 1; await patchCurrent({ attempt: cur.attempt }); await log("info", `Resuming ${label(cur.app)} after the extension was suspended.`); }
    else await log("info", `Opening ${label(cur.app)}`);
    result = await runWithTimeout(cur.app, cur.startedAt + JOB_TIMEOUT_MS);
  }
  await finishJob(cur.app, result);
}

async function runWithTimeout(app, deadline) {
  const ctx = { cancelled: false, deadline, submitClicked: false, clicked: false, focused: false };
  activeCtx = ctx;
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => { ctx.cancelled = true; ctx.cancelReason = "timeout"; r({ timeout: true }); }, Math.max(1000, deadline - Date.now())); });
  try {
    const res = await Promise.race([doJob(app, ctx), timeout]);
    if (res.timeout) return ctx.submitClicked ? { outcome: "review", reason: "Clicked Submit but hit the 90s limit before a confirmation. Check whether it went through." } : { outcome: "review", reason: "Timed out after 90s." };
    return res;
  } catch (e) {
    if (e instanceof Cancelled || ctx.cancelled) {
      if (ctx.cancelReason === "timeout") return { outcome: "review", reason: ctx.submitClicked ? "Clicked Submit but hit the 90s limit before a confirmation." : "Timed out after 90s." };
      return ctx.submitClicked ? { outcome: "review", reason: "Stopped right after Submit. Check whether it went through." } : { outcome: "left", reason: "Stopped." };
    }
    if (e && e.noAccess) return { outcome: "left", reason: "Chrome would not let ApplyPilot read this site. Allow all sites in the Auto tab." };
    if (e && FATAL.has(e.status)) return { outcome: "fatal", reason: e.message };
    if (e && e.status) return { outcome: "left", reason: `Server error: ${e.message}` };
    if (/No tab with id/i.test(String(e && e.message))) return { outcome: "left", reason: "The Auto mode tab was closed." };
    return { outcome: ctx.submitClicked ? "review" : "left", reason: `Unexpected error: ${String(e && e.message || e).slice(0, 160)}` };
  } finally { clearTimeout(timer); ctx.cancelled = true; if (activeCtx === ctx) activeCtx = null; }
}

/** Ask the server for fresh matching jobs; they arrive already saved in the tracker (source "auto"). */
async function runDiscovery(ds, remaining) {
  const st0 = await patch({ status: "discovering", message: "Finding matching jobs…" });
  await log("info", `Finding new jobs${ds.keywords ? ` for "${ds.keywords}"` : " from your profile"}${ds.location ? ` in ${ds.location}` : ""} (min fit ${ds.minScore}%)…`);
  let res;
  try {
    res = await api("/api/auto/discover", { body: { keywords: ds.keywords, location: ds.location, remote: ds.remote, minScore: ds.minScore, remaining: Math.max(1, remaining) } });
  } catch (e) {
    // 429 = today's discovery limit: not fatal, keep working through whatever is already queued.
    if (e && FATAL.has(e.status) && e.status !== 429) { await stopRun(`Stopped: ${e.message}`); return "fatal"; }
    await log("warn", `Job discovery failed: ${e && e.message || e}`);
    if (!(await getState()).running) return "stopped";
    await patch({ needDiscover: false, discoverDry: true, discoverNote: String(e && e.message || e).slice(0, 200), discoverRounds: st0.discoverRounds + 1, status: "running", message: "" });
    return "error";
  }
  const st = await getState();
  if (!st.running) return "stopped";
  const have = new Set([...st.queue.map((a) => a.id), st.current && st.current.app && st.current.app.id].filter(Boolean));
  const fresh = (res.queue || []).filter((a) => a && a.id && a.url && !have.has(a.id) && !EXCLUDED_HOSTS.test(hostOf(a.url)))
    .map((a) => ({ id: a.id, job_id: a.job_id, company: a.company, title: a.title, url: a.url, score: a.score, auto: true }));
  // Keep the 20–60s gap between applications when discovery refills the queue mid-run.
  const delay = fresh.length && !st.queue.length && (st.submitted + st.skipped) > 0 ? rand(DELAY_MIN_MS, DELAY_MAX_MS) : 0;
  await patch({ queue: [...st.queue, ...fresh], total: st.total + fresh.length, discovered: st.discovered + fresh.length,
    discoverRounds: st.discoverRounds + 1, discoverDry: fresh.length === 0, needDiscover: false,
    status: delay ? "waiting" : "running", nextAt: delay ? Date.now() + delay : 0, message: delay ? `Next job in ${Math.round(delay / 1000)}s` : "" });
  if (fresh.length) await bumpDiscovered(fresh.length);
  const s = res.stats || {};
  await log(fresh.length ? "ok" : "info", fresh.length
    ? `Found ${fresh.length} new job${fresh.length === 1 ? "" : "s"} (checked ${s.considered || 0}; ${s.duplicates || 0} already in your tracker, ${s.belowScore || 0} below ${res.minScore}% fit). Added to the tracker as Saved · Auto.`
    : `No new matching jobs (checked ${s.considered || 0}; ${s.duplicates || 0} already in your tracker, ${s.belowScore || 0} below ${res.minScore}% fit${s.offRole ? `, ${s.offRole} other roles` : ""}).`);
  return "ok";
}

const label = (app) => [app.company, app.title].filter(Boolean).join(" · ") || app.url;

async function finishJob(app, result) {
  let st = await getState();
  const p = { current: null };
  try {
    if (result.outcome === "applied") {
      await api("/api/applications", { body: { id: app.id, status: "applied", auto_note: `Submitted automatically (${result.reason}).` } });
      const d = await bumpDaily();
      p.submitted = st.submitted + 1;
      await log("ok", `Submitted: ${label(app)} (${d.count} today)`);
    } else if (result.outcome === "review") {
      await api("/api/applications", { body: { id: app.id, status: "needs_review", auto_note: result.reason } });
      p.skipped = st.skipped + 1;
      await log("warn", `Needs review: ${label(app)}: ${result.reason}`);
    } else {
      p.skipped = st.skipped + 1;
      await log(result.outcome === "fatal" ? "error" : "warn", `Skipped (left as Saved): ${label(app)}: ${result.reason}`);
    }
  } catch (e) {
    await log("error", `Could not update the tracker for ${label(app)}: ${e.message}`);
    if (result.outcome === "applied") { await bumpDaily(); p.submitted = st.submitted + 1; }
  }
  st = await patch(p);
  if (result.outcome === "fatal") return stopRun(`Stopped: ${result.reason}`);
  if (!st.running) return;
  if (st.queue.length) {
    const delay = rand(DELAY_MIN_MS, DELAY_MAX_MS);
    await patch({ nextAt: Date.now() + delay, status: "waiting", message: `Next job in ${Math.round(delay / 1000)}s` });
  }
}

async function startRun() {
  const st = await getState();
  if (st.running) return { ok: true, already: true };
  if ((await bGet()).running) return { ok: false, error: "Board Auto-Apply is running. Stop it first (one tab at a time)." };
  const { autoEnabled, api: base, key } = await chrome.storage.local.get(["autoEnabled", "api", "key"]);
  if (!autoEnabled) return { ok: false, error: "Turn Auto mode on first." };
  if (!base || !key) return { ok: false, error: "Connect your account in Settings first." };
  const cap = await getCap(), daily = await getDaily();
  if (daily.count >= cap) return { ok: false, error: `Daily cap reached (${daily.count}/${cap}). Resets at midnight IST.` };
  let queue;
  try { queue = (await api("/api/applications?queue=auto", { method: "GET" })).queue || []; }
  catch (e) { return { ok: false, error: e.message }; }
  const ds = await getDiscoverySettings();
  if (!queue.length && !ds.on) return { ok: false, error: "No saved jobs with an apply link in your tracker. Turn on \"Find jobs automatically\" to let Auto mode find some." };
  await chrome.storage.session.set({ autoAlive: true });
  await patch({ ...DEFAULT_STATE, tabId: st.tabId, running: true, status: "running", message: "", queue, total: queue.length, startedAt: Date.now(), needDiscover: ds.on });
  await log("info", `Started: ${queue.length} saved job${queue.length === 1 ? "" : "s"} in the queue${ds.on ? ", plus automatic job discovery" : ""}, ${cap - daily.count} left under today's cap.`);
  chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  kick();
  return { ok: true };
}

async function stopRun(message = "Stopped.") {
  if (activeCtx) { activeCtx.cancelled = true; activeCtx.cancelReason = "stop"; }
  await chrome.alarms.clear(TICK); await chrome.alarms.clear(NEXT);
  await patch({ running: false, status: "stopped", message, nextAt: 0, ...(activeCtx ? {} : { current: null }) });
  await log("info", message);
  await closeTab();
}

// ───────────────────────── wiring
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string") return;
  if (msg.type === "auto:start") { startRun().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) })); return true; }
  if (msg.type === "auto:stop") { Promise.all([stopRun("Stopped by you."), bGet().then((b) => (b.running ? bStop("Stopped by you.") : null))]).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: true })); return true; }
  // v2.3 Board Auto-Apply (runner in boardrunner.js). Each reply carries the current board state.
  const withState = (r) => bGet().then((state) => sendResponse({ ...(r || { ok: true }), state }));
  const fail = (e) => sendResponse({ ok: false, error: String((e && e.message) || e) });
  if (msg.type === "board:start") { bStart().then(withState).catch(fail); return true; }
  if (msg.type === "board:stop") { bGet().then((b) => (b.running ? bStop("Stopped by you.") : null)).then(() => withState({ ok: true })).catch(fail); return true; }
  if (msg.type === "board:state") { withState({ ok: true }).catch(fail); return true; }
  // v2.4: refresh website settings / lightweight sign-in check for the side panel.
  if (msg.type === "board:settings") { fetchAutoSettings().then((settings) => sendResponse({ ok: true, settings })).catch(fail); return true; }
  if (msg.type === "board:check") { bLightCheck().then((list) => sendResponse({ ok: true, list })).catch(fail); return true; }
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === TICK || a.name === NEXT) kick(); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.autoEnabled && c.autoEnabled.newValue === false) getState().then((s) => { if (s.running) stopRun("Auto mode was turned off."); });
});

// Forget per-tab application state when a tab closes; if the Auto tab is closed, forget it.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {});
  getState().then((s) => { if (s.tabId === tabId) patch({ tabId: null }); });
});

// Worker woke up while a run is in progress. storage.session survives worker suspension but not a Chrome restart:
// after suspension, continue; after a full restart, don't resume submitting silently: stop and let the user press Start.
getState().then(async (s) => {
  if (!s.running) return;
  const { autoAlive } = await chrome.storage.session.get("autoAlive");
  if (autoAlive) kick();
  else { await patch({ current: null, tabId: null }); await stopRun("Stopped because Chrome restarted. Press Start to continue."); }
});

// ───────────────────────── v2.3 Board Auto-Apply
// Loaded last so the helpers above (api, log, serial, getDaily, getCap, istDay, sleep, rand, hostOf, noHash,
// Cancelled, guard, wait, FATAL, getState, getDiscoverySettings) exist before the runner's top-level code runs.
importScripts("boards.js", "boardrunner.js");

// ApplyPilot side panel. All API calls happen here (extension origin), never in page scripts.
// Page access is on demand: chrome.scripting + activeTab, with optional host permissions as a fallback.
// Security: every piece of page/API text is rendered with textContent, never innerHTML.
// The Auto tab only shows state and sends start/stop messages; the Auto mode runner lives in background.js.
"use strict";

const $ = (id) => document.getElementById(id);
const JOB_SITES = [
  "https://*.linkedin.com/*", "https://*.naukri.com/*", "https://internshala.com/*", "https://*.internshala.com/*",
  "https://*.indeed.com/*", "https://*.indeed.co.in/*", "https://*.greenhouse.io/*", "https://*.lever.co/*",
  "https://*.myworkdayjobs.com/*", "https://*.myworkdaysite.com/*"
];
const NEED_ACCESS = "NEED_ACCESS";

let settings = { api: "", key: "" };
let current = { tabId: null, job: null, jobId: null, applicationId: null, pageBase: "", fields: new Map(), asks: [] };

// ───────── small DOM helpers (textContent only)
function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
function say(id, msg, kind = "") { const n = $(id); n.textContent = msg || ""; n.className = `msg ${kind}`; }
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Working…"; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

// ───────── settings
async function loadSettings() {
  const s = await chrome.storage.local.get(["api", "key", "resumeName"]);
  settings = { api: s.api || "", key: s.key || "" };
  $("api").value = settings.api; $("key").value = settings.key;
  $("resumeName").textContent = s.resumeName ? `Saved resume: ${s.resumeName}` : "No resume saved for auto-attach.";
  if (!settings.api || !settings.key) toggleSettings(true);
}
function toggleSettings(show) {
  const open = show ?? $("settings").hidden;
  $("settings").hidden = !open; $("settingsBtn").setAttribute("aria-expanded", String(open));
}
$("settingsBtn").addEventListener("click", () => toggleSettings());
$("saveSettings").addEventListener("click", async () => {
  let api = $("api").value.trim().replace(/\/+$/, "");
  const key = $("key").value.trim();
  try { const u = new URL(api); if (!/^https?:$/.test(u.protocol)) throw 0; api = u.origin; } catch { return say("settingsMsg", "Enter a valid API URL, e.g. https://your-app.vercel.app", "bad"); }
  if (!/^ap_[A-Za-z0-9_-]{20,80}$/.test(key)) return say("settingsMsg", "That does not look like an ApplyPilot key (starts with ap_).", "bad");
  const data = { api, key };
  const f = $("resume").files[0];
  if (f) {
    if (f.type !== "application/pdf" || f.size > 5 * 1024 * 1024) return say("settingsMsg", "Resume must be a PDF under 5 MB.", "bad");
    data.resumeB64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    data.resumeName = f.name;
  }
  await chrome.storage.local.set(data);
  settings = { api, key };
  try { await apiCall("/api/me", { method: "GET" }); say("settingsMsg", "Connected ✓", "ok"); setTimeout(() => toggleSettings(false), 700); loadAnswers(); detect(); }
  catch (e) { say("settingsMsg", e.message, "bad"); }
  if (data.resumeName) $("resumeName").textContent = `Saved resume: ${data.resumeName}`;
});
$("openDash").addEventListener("click", () => { if (settings.api) chrome.tabs.create({ url: `${settings.api}/dashboard` }); else say("settingsMsg", "Add the API URL first.", "bad"); });
// Permission requests must start synchronously inside the click handler (user gesture).
$("allowJobSites").addEventListener("click", () => {
  chrome.permissions.request({ origins: JOB_SITES }).then((ok) => { say("settingsMsg", ok ? "Allowed on job boards ✓" : "Not allowed.", ok ? "ok" : "bad"); if (ok) detect(); }).catch((e) => say("settingsMsg", String(e.message || e), "bad"));
});
$("allowAll").addEventListener("click", () => {
  chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).then((ok) => { say("settingsMsg", ok ? "Allowed on all sites ✓ (still only runs when you click)" : "Not allowed.", ok ? "ok" : "bad"); if (ok) detect(); }).catch((e) => say("settingsMsg", String(e.message || e), "bad"));
});

// ───────── API
async function apiCall(path, { method = "POST", body } = {}) {
  if (!settings.api || !settings.key) { toggleSettings(true); throw new Error("Connect your account in Settings first."); }
  let r;
  try {
    r = await fetch(settings.api + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.key}` }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("Could not reach the ApplyPilot server. Check the API URL in Settings."); }
  let j = {}; try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401) throw new Error("Your API key is invalid or revoked. Create a new one in Dashboard → Extension.");
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ───────── tabs & injection
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error("No active tab.");
  return tab;
}
async function exec(tabId, opts, allFrames = false) {
  try { return await chrome.scripting.executeScript({ target: { tabId, allFrames }, ...opts }); }
  catch (e) {
    const m = String(e && e.message || e);
    if (allFrames) return exec(tabId, opts, false);
    if (/cannot access|permission|host|activeTab|chrome:\/\/|extensions gallery|Cannot be scripted/i.test(m)) throw new Error(NEED_ACCESS);
    throw e;
  }
}
const accessHelp = "ApplyPilot can't read this tab yet. Click the ApplyPilot toolbar icon while on this tab (or press Alt+Shift+A), or allow access in Settings → Site access. Chrome pages can't be read.";
const pageBaseOf = (url) => { try { const u = new URL(url); return u.origin + u.pathname.split("/").slice(0, 4).join("/"); } catch { return ""; } };

async function loadTabState(tabId) {
  const k = `tab:${tabId}`; const s = (await chrome.storage.session.get(k))[k] || {};
  current = { ...current, tabId, jobId: s.jobId || null, applicationId: s.applicationId || null, pageBase: s.pageBase || "" };
}
async function saveTabState() {
  if (current.tabId == null) return;
  await chrome.storage.session.set({ [`tab:${current.tabId}`]: { jobId: current.jobId, applicationId: current.applicationId, pageBase: current.pageBase } });
}

// ───────── tabs UI
const TABS = ["job", "fill", "answers", "auto"];
function showTab(name) {
  for (const t of TABS) { $(`tab-${t}`).setAttribute("aria-selected", String(t === name)); $(`panel-${t}`).hidden = t !== name; }
  if (name === "answers") loadAnswers();
  if (name === "auto") renderAuto();
}
TABS.forEach((t) => $(`tab-${t}`).addEventListener("click", () => showTab(t)));
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  const i = TABS.findIndex((t) => $(`tab-${t}`).getAttribute("aria-selected") === "true");
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]; showTab(n); $(`tab-${n}`).focus(); }
});

// ───────── Job tab
function setRing(v) {
  const ring = $("ring"); const val = Math.max(0, Math.min(100, Math.round(v)));
  ring.style.setProperty("--v", String(val));
  ring.style.setProperty("--c", val >= 75 ? "var(--ok)" : val >= 50 ? "var(--brand)" : val >= 30 ? "var(--warn)" : "var(--bad)");
  ring.setAttribute("aria-valuenow", String(val)); $("ringVal").textContent = String(val);
}

let detecting = false;
async function detect() {
  if (detecting) return; detecting = true;
  $("jobBody").hidden = true; $("fitOut").hidden = true; $("coverOut").hidden = true; say("jobMsg", "");
  $("jobSource").textContent = "Looking for a job on this page…";
  try {
    const tab = await activeTab();
    await loadTabState(tab.id);
    const [res] = await exec(tab.id, { files: ["detect.js"] });
    const job = res && res.result;
    const base = pageBaseOf(job && job.url || "");
    if (current.pageBase && base !== current.pageBase) { current.jobId = null; current.applicationId = null; }
    current.pageBase = base; await saveTabState();
    if (!job || !job.found) {
      current.job = null;
      $("jobSource").textContent = job && job.hasForm ? "No job posting found, but this page has a form. Try the Autofill tab." : "No job posting detected on this page.";
      return;
    }
    current.job = job;
    $("jobSource").textContent = `Detected via ${job.source === "json-ld" ? "structured job data" : job.source}${job.confidence === "low" ? " (best guess)" : ""}`;
    $("jobTitle").textContent = job.title;
    $("jobCompany").textContent = [job.company, job.location, job.remote ? "Remote" : ""].filter(Boolean).join(" · ");
    $("jobBody").hidden = false;
    setRing(0); $("ringVal").textContent = "…"; clear($("chips")); $("scoreNote").textContent = "";
    if (!settings.key) { $("scoreNote").textContent = "Connect your account in Settings to see your fit score."; return; }
    if ((job.description || "").length < 40) { $("ringVal").textContent = "–"; $("scoreNote").textContent = "Not enough description text to score."; return; }
    try {
      const s = await apiCall("/api/score", { body: { title: job.title, description: job.description } });
      setRing(s.score);
      $("scoreNote").textContent = `ATS keyword match: ${s.matched.length} of ${s.total} job keywords are in your profile.`;
      const chips = $("chips"); clear(chips);
      s.matched.slice(0, 8).forEach((k) => chips.append(el("span", { class: "chip ok", text: k })));
      s.missing.slice(0, 8).forEach((k) => chips.append(el("span", { class: "chip miss", text: k })));
    } catch (e) { $("ringVal").textContent = "–"; $("scoreNote").textContent = e.message; }
  } catch (e) {
    $("jobSource").textContent = e.message === NEED_ACCESS ? accessHelp : `Could not read this page: ${e.message}`;
  } finally { detecting = false; }
}
$("detectBtn").addEventListener("click", detect);

async function ensureJob(track = false) {
  if (!current.job) throw new Error("No job detected on this page.");
  if (current.jobId && !track) return current.jobId;
  const j = current.job;
  const r = await apiCall("/api/jobs", { body: { job: { title: j.title, company: j.company, location: j.location, remote: j.remote, description: j.description, apply_url: j.url, posted_at: j.posted_at, salary: j.salary, source: "extension" }, track } });
  current.jobId = r.job.id; if (r.applicationId) current.applicationId = r.applicationId;
  await saveTabState();
  return current.jobId;
}
$("saveJob").addEventListener("click", async (e) => {
  busy(e.currentTarget, true, "Saving…");
  try { await ensureJob(true); say("jobMsg", "Saved to your tracker ✓", "ok"); } catch (err) { say("jobMsg", err.message, "bad"); }
  busy($("saveJob"), false);
});
$("tailorJob").addEventListener("click", async (e) => {
  busy(e.currentTarget, true, "Opening…");
  try { const id = await ensureJob(); chrome.tabs.create({ url: `${settings.api}/dashboard/tailor?job=${encodeURIComponent(id)}` }); } catch (err) { say("jobMsg", err.message, "bad"); }
  busy($("tailorJob"), false);
});
$("coverJob").addEventListener("click", async (e) => {
  busy(e.currentTarget, true, "Writing…");
  try {
    const id = await ensureJob();
    const r = await apiCall("/api/cover-letter", { body: { jobId: id } });
    $("coverText").value = r.cover_letter; updateWords(); $("coverOut").hidden = false;
    say("jobMsg", "Cover letter ready. Edit it, then copy.", "ok");
  } catch (err) { say("jobMsg", err.message, "bad"); }
  busy($("coverJob"), false);
});
function updateWords() { const n = ($("coverText").value.trim().match(/\S+/g) || []).length; $("coverWords").textContent = `${n} words`; }
$("coverText").addEventListener("input", updateWords);
$("copyCover").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("coverText").value); say("jobMsg", "Copied ✓", "ok"); } catch { say("jobMsg", "Copy failed. Select the text and copy.", "bad"); }
});
$("fitJob").addEventListener("click", async (e) => {
  busy(e.currentTarget, true, "Analysing…");
  try {
    const id = await ensureJob();
    const m = await apiCall("/api/match", { body: { jobId: id } });
    const out = $("fitOut"); clear(out); out.className = "fit"; out.hidden = false;
    out.append(el("div", { class: "divider" }), el("h3", { text: `AI fit: ${m.fit_score}/100` }), el("p", { class: "small", text: m.verdict || "" }));
    if (m.reasons && m.reasons.length) out.append(el("ul", {}, m.reasons.map((r) => el("li", { text: r }))));
    if (m.gaps && m.gaps.length) out.append(el("p", { class: "small muted", text: "Gaps:" }), el("ul", {}, m.gaps.map((r) => el("li", { text: r }))));
  } catch (err) { say("jobMsg", err.message, "bad"); }
  busy($("fitJob"), false);
});

// ───────── Autofill tab
$("fillBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget; busy(btn, true, "Reading the form…"); say("fillMsg", ""); $("fillOut").hidden = true;
  try {
    const tab = await activeTab(); await loadTabState(tab.id);
    await exec(tab.id, { files: ["autofill.js"] }, true);
    const frames = await exec(tab.id, { func: () => (window.__AP ? window.__AP.collect() : null) }, true);
    const fields = []; let url = "", title = "";
    for (const f of frames) { const r = f.result; if (!r) continue; fields.push(...r.fields); if (r.top || !url) { url = r.url; title = r.title; } }
    if (!fields.length) throw new Error("No form fields found on this page. Open the application form first.");
    const base = pageBaseOf(url);
    if (current.pageBase && base !== current.pageBase) { current.applicationId = null; current.jobId = null; }
    current.pageBase = base;
    current.fields = new Map(fields.map((f) => [f.id, f]));

    btn.textContent = "Filling…";
    const res = await apiCall("/api/agent", { body: { url, pageTitle: title, fields: fields.slice(0, 150), jobId: current.jobId, applicationId: current.applicationId } });
    current.applicationId = res.applicationId || current.applicationId; await saveTabState();

    const results = await exec(tab.id, { func: (actions) => (window.__AP ? window.__AP.apply(actions) : { filled: 0, asks: [] }), args: [res.actions || []] }, true);
    let filled = 0; const asks = []; let submitFound = false;
    for (const r of results) { if (!r.result) continue; filled += r.result.filled; asks.push(...r.result.asks); submitFound = submitFound || r.result.submitFound; }
    current.asks = asks;
    renderFill(filled, asks, submitFound, res);
  } catch (err) {
    say("fillMsg", err.message === NEED_ACCESS ? accessHelp : err.message, "bad");
  }
  busy(btn, false);
});

function renderFill(filled, asks, submitFound, res) {
  $("fillOut").hidden = false;
  $("fillSummary").textContent = `${res.company || res.title ? `${[res.title, res.company].filter(Boolean).join(" at ")}: ` : ""}filled ${filled} field${filled === 1 ? "" : "s"}, ${asks.length} need you. ${submitFound ? "Check everything, then click the blue-outlined button yourself." : "Check everything before you submit."}`;
  const list = $("askList"); clear(list);
  asks.slice(0, 25).forEach((a) => {
    const f = current.fields.get(a.id);
    list.append(el("div", { class: "ask" }, [el("b", { text: (f && f.label) || "Field" }), el("span", { class: "muted", text: a.reason || "Needs you" })]));
  });
  $("saveAnswers").hidden = !asks.some((a) => { const f = current.fields.get(a.id); return f && f.type !== "file"; });
  say("fillMsg", res.counted ? "Counted as 1 autofill this month." : "Same application as before: not counted again.", "");
}

$("saveAnswers").addEventListener("click", async (e) => {
  busy(e.currentTarget, true, "Saving…");
  try {
    const tab = await activeTab();
    const ids = current.asks.map((a) => a.id);
    const frames = await exec(tab.id, { func: (list) => (window.__AP ? window.__AP.readAnswers(list) : []), args: [ids] }, true);
    const answers = frames.flatMap((f) => f.result || []).filter((x) => x && x.q && x.a);
    if (!answers.length) throw new Error("Answer the orange fields on the page first, then click Save my answers.");
    const r = await apiCall("/api/answers", { body: { answers } });
    say("fillMsg", `Saved ${r.saved} answer${r.saved === 1 ? "" : "s"} to your answer bank ✓${r.skipped ? ` (${r.skipped} salary/ID answers are never stored)` : ""}`, "ok");
    loadAnswers(true);
  } catch (err) { say("fillMsg", err.message === NEED_ACCESS ? accessHelp : err.message, "bad"); }
  busy($("saveAnswers"), false);
});

$("markApplied").addEventListener("click", async (e) => {
  if (!current.applicationId) return say("fillMsg", "Fill the form first so there is an application to track.", "bad");
  busy(e.currentTarget, true, "Updating…");
  try {
    await apiCall("/api/applications", { body: { id: current.applicationId, status: "applied" } });
    say("fillMsg", "Tracked as applied ✓ Good luck!", "ok");
    current.applicationId = null; current.jobId = null; await saveTabState();
  } catch (err) { say("fillMsg", err.message, "bad"); }
  busy($("markApplied"), false);
});

// ───────── Answers tab
const ANSWER_LABELS = {
  work_authorization_india: "Work authorisation", notice_period: "Notice period", willing_to_relocate: "Willing to relocate",
  available_from: "Available from", preferred_locations: "Preferred locations", graduation_year: "Graduation year", languages: "Languages",
  expected_ctc: "Expected CTC", current_ctc: "Current CTC"
};
let answerItems = null;
async function loadAnswers(force = false) {
  if (answerItems && !force) return renderAnswers();
  if (!settings.key) { const l = $("answerList"); clear(l); l.append(el("p", { class: "empty", text: "Connect your account in Settings to see your saved answers." })); return; }
  try {
    const { profile: p } = await apiCall("/api/profile", { method: "GET" });
    const items = [];
    const add = (q, a) => { if (a && String(a).trim()) items.push({ q, a: String(a) }); };
    add("Full name", p.full_name); add("Email", p.email); add("Phone", p.phone); add("Location", p.location);
    add("LinkedIn", p.linkedin); add("GitHub", p.github); add("Portfolio", p.portfolio); add("Headline", p.headline); add("Summary", p.summary);
    const edu = (p.education || [])[0]; if (edu) { add("Degree", [edu.degree, edu.field].filter(Boolean).join(", ")); add("College", edu.institution); add("CGPA / %", edu.grade); }
    add("Skills", (p.skills || []).join(", "));
    for (const [k, label] of Object.entries(ANSWER_LABELS)) add(label, p.answers && p.answers[k]);
    for (const x of p.answer_bank || []) add(x.q, x.a);
    answerItems = items; renderAnswers();
  } catch (e) { say("answersMsg", e.message, "bad"); }
}
function renderAnswers() {
  const list = $("answerList"); clear(list);
  const term = $("answerSearch").value.trim().toLowerCase();
  const items = (answerItems || []).filter((x) => !term || x.q.toLowerCase().includes(term) || x.a.toLowerCase().includes(term));
  if (!items.length) { list.append(el("p", { class: "empty", text: answerItems && answerItems.length ? "No matches." : "No saved answers yet. Add them in Dashboard → Profile." })); return; }
  for (const x of items) {
    const b = el("button", { class: "answer", type: "button", title: "Click to copy" }, [el("span", { class: "q", text: x.q }), el("span", { class: "a", text: x.a })]);
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(x.a); b.classList.add("copied"); say("answersMsg", `Copied “${x.q}” ✓`, "ok"); setTimeout(() => b.classList.remove("copied"), 1200); }
      catch { say("answersMsg", "Copy failed.", "bad"); }
    });
    list.append(b);
  }
}
$("answerSearch").addEventListener("input", renderAnswers);
$("reloadAnswers").addEventListener("click", () => loadAnswers(true));

// ───────── Auto tab (the run itself lives in background.js; this only shows state and sends start/stop)
const ALL_SITES = ["https://*/*", "http://*/*"];
async function renderAccess() {
  const all = await chrome.permissions.contains({ origins: ALL_SITES });
  const boards = all || await chrome.permissions.contains({ origins: JOB_SITES });
  $("autoAccess").hidden = all;
  $("autoAccessOk").hidden = !boards;
  $("autoAccessOk").textContent = all ? "Site access: all sites ✓" : boards ? "Site access: job boards only. Jobs on other employer sites will be skipped." : "";
  return boards;
}
function requestAccess(origins) {
  chrome.permissions.request({ origins }).then((ok) => { say("autoMsg", ok ? "Access granted ✓" : "Not allowed.", ok ? "ok" : "bad"); renderAccess(); })
    .catch((e) => say("autoMsg", String(e.message || e), "bad"));
}
// Permission requests must start synchronously in the click handler (user gesture).
$("autoAllowAll").addEventListener("click", () => requestAccess(ALL_SITES));
$("autoAllowBoards").addEventListener("click", () => requestAccess(JOB_SITES));

const istDayUI = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const STATUS_TEXT = { idle: "Idle", running: "Running", waiting: "Waiting before the next job", discovering: "Finding matching jobs", stopped: "Stopped" };
async function renderAuto() {
  const d = await chrome.storage.local.get(["autoEnabled", "autoCap", "autoState", "autoLog", "autoDaily", "autoDiscover", "autoKeywords", "autoLocation", "autoRemote", "autoMinScore"]);
  const st = d.autoState || {}; const cap = Number(d.autoCap) || 20;
  const today = d.autoDaily && d.autoDaily.day === istDayUI() ? d.autoDaily.count : 0;
  $("autoEnabled").checked = !!d.autoEnabled; $("autoEnabledLabel").textContent = d.autoEnabled ? "On" : "Off";
  if (document.activeElement !== $("autoCap")) $("autoCap").value = String(cap);
  $("autoStart").disabled = !d.autoEnabled || !!st.running; $("autoStop").disabled = !st.running;
  let status = STATUS_TEXT[st.status] || "Idle";
  if (st.status === "waiting" && st.nextAt) status += ` (${Math.max(0, Math.round((st.nextAt - Date.now()) / 1000))}s)`;
  $("autoStatus").textContent = st.message && !st.running ? `${status}: ${st.message}` : status;
  const cur = st.current && st.current.app;
  $("autoCurrent").textContent = cur ? `Now: ${[cur.company, cur.title].filter(Boolean).join(" · ") || cur.url}${st.current.step === "submitting" ? " (submitting…)" : ""}` : "";
  $("autoToday").textContent = `${today}/${cap}`;
  $("autoFoundToday").textContent = String(d.autoDaily && d.autoDaily.day === istDayUI() ? d.autoDaily.discovered || 0 : 0);
  // Discovery settings ("Find jobs automatically" is on unless the user turned it off).
  const disc = d.autoDiscover !== false;
  $("autoDiscover").checked = disc; $("autoDiscoverLabel").textContent = disc ? "On" : "Off";
  $("autoDiscoverFields").setAttribute("aria-disabled", String(!disc));
  for (const [id, key] of [["autoKeywords", "autoKeywords"], ["autoLocation", "autoLocation"]]) if (document.activeElement !== $(id)) $(id).value = d[key] || "";
  $("autoRemote").checked = d.autoRemote !== false;
  if (document.activeElement !== $("autoMinScore")) $("autoMinScore").value = String(Number.isFinite(Number(d.autoMinScore)) && d.autoMinScore !== undefined ? d.autoMinScore : 30);
  $("autoSubmitted").textContent = String(st.submitted || 0); $("autoSkipped").textContent = String(st.skipped || 0);
  $("autoLeft").textContent = String((st.queue || []).length);
  const ol = $("autoLog"); clear(ol);
  const items = d.autoLog || [];
  if (!items.length) ol.append(el("li", { class: "empty" }, [el("span", { text: "" }), el("span", { class: "muted", text: "Nothing yet." })]));
  for (const x of items.slice(0, 100)) {
    const t = new Date(x.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    ol.append(el("li", {}, [el("time", { text: t }), el("span", { class: x.kind || "", text: x.text || "" })]));
  }
  renderAccess();
}
$("autoEnabled").addEventListener("change", async (e) => {
  const on = e.currentTarget.checked;
  if (on && !(await renderAccess())) say("autoMsg", "Allow site access below before you start.", "bad"); else say("autoMsg", "");
  await chrome.storage.local.set({ autoEnabled: on });
});
$("autoCap").addEventListener("change", async (e) => {
  const n = Math.floor(Number(e.currentTarget.value));
  if (!Number.isFinite(n) || n < 1 || n > 200) { say("autoMsg", "Cap must be between 1 and 200.", "bad"); return renderAuto(); }
  await chrome.storage.local.set({ autoCap: n }); say("autoMsg", `Daily cap set to ${n}.`, "ok");
});
$("autoDiscover").addEventListener("change", async (e) => {
  const on = e.currentTarget.checked;
  await chrome.storage.local.set({ autoDiscover: on });
  say("autoMsg", on ? "Auto mode will find matching jobs when the queue is empty." : "Auto mode will only use jobs you saved yourself.", "ok");
});
$("autoKeywords").addEventListener("change", async (e) => { await chrome.storage.local.set({ autoKeywords: e.currentTarget.value.trim().slice(0, 300) }); say("autoMsg", "Keywords saved.", "ok"); });
$("autoLocation").addEventListener("change", async (e) => { await chrome.storage.local.set({ autoLocation: e.currentTarget.value.trim().slice(0, 200) }); say("autoMsg", "Location saved.", "ok"); });
$("autoRemote").addEventListener("change", async (e) => { await chrome.storage.local.set({ autoRemote: e.currentTarget.checked }); });
$("autoMinScore").addEventListener("change", async (e) => {
  const n = Math.round(Number(e.currentTarget.value));
  if (!Number.isFinite(n) || n < 0 || n > 100) { say("autoMsg", "Min fit score must be between 0 and 100.", "bad"); return renderAuto(); }
  await chrome.storage.local.set({ autoMinScore: n }); say("autoMsg", `Min fit score set to ${n}%.`, "ok");
});
$("autoStart").addEventListener("click", async (e) => {
  if (!(await renderAccess())) return say("autoMsg", "Allow site access first (all sites recommended).", "bad");
  busy(e.currentTarget, true, "Starting…");
  try {
    const r = await chrome.runtime.sendMessage({ type: "auto:start" });
    if (!r || !r.ok) say("autoMsg", (r && r.error) || "Could not start.", "bad"); else say("autoMsg", "Started. You can keep browsing; jobs open in a background tab.", "ok");
  } catch (err) { say("autoMsg", String(err.message || err), "bad"); }
  busy($("autoStart"), false); renderAuto();
});
$("autoStop").addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "auto:stop" }); say("autoMsg", "Stopped.", ""); } catch (err) { say("autoMsg", String(err.message || err), "bad"); }
  renderAuto();
});
$("autoClearLog").addEventListener("click", async () => { await chrome.storage.local.set({ autoLog: [] }); renderAuto(); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && (c.autoState || c.autoLog || c.autoDaily || c.autoEnabled || c.autoCap || c.autoDiscover || c.autoRemote) && !$("panel-auto").hidden) renderAuto();
});
setInterval(() => { if (!$("panel-auto").hidden) renderAuto(); }, 5000); // keeps the "next job in Ns" countdown fresh

// ───────── follow the active tab
let detectTimer = null;
const scheduleDetect = () => { clearTimeout(detectTimer); detectTimer = setTimeout(detect, 400); };
chrome.tabs.onActivated.addListener(scheduleDetect);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === "complete" && tabId === current.tabId) scheduleDetect(); });

loadSettings().then(detect);

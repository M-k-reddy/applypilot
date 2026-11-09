// ApplyPilot side panel v2.5: no tabs. Header (Auto switch, gear) · status card with ONE primary button · context card
// (job post or form on this tab) · board sign-in chips · recent activity.
// All API calls happen here (extension origin), never in page scripts. Page access is on demand (activeTab + optional
// host permissions). Every piece of page/API text is rendered with textContent, never innerHTML.
// The Auto runners live in background.js / boardrunner.js; this panel only shows state and sends start/stop.
"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULT_SITE = "https://applypilot-theta.vercel.app";
const JOB_SITES = [
  "https://*.linkedin.com/*", "https://*.naukri.com/*", "https://internshala.com/*", "https://*.internshala.com/*",
  "https://*.indeed.com/*", "https://*.indeed.co.in/*", "https://*.greenhouse.io/*", "https://*.lever.co/*",
  "https://*.myworkdayjobs.com/*", "https://*.myworkdaysite.com/*", "https://jobs.ashbyhq.com/*",
  "https://*.shine.com/*", "https://*.hirist.tech/*", "https://*.instahyre.com/*", "https://cutshort.io/*", "https://wellfound.com/*"
];
const ALL_SITES = ["https://*/*", "http://*/*"];
const NEED_ACCESS = "NEED_ACCESS";
const BOARDS = [
  { id: "naukri", name: "Naukri", login: "https://www.naukri.com/nlogin/login" },
  { id: "internshala", name: "Internshala", login: "https://internshala.com/login/user" },
  { id: "indeed", name: "Indeed", login: "https://secure.indeed.com/auth?hl=en_IN&co=IN" },
  { id: "shine", name: "Shine", login: "https://www.shine.com/myshine/login" },
  { id: "hirist", name: "Hirist", login: "https://www.hirist.tech/login" },
  { id: "instahyre", name: "Instahyre", login: "https://www.instahyre.com/login/" },
  { id: "cutshort", name: "Cutshort", login: "https://cutshort.io/login" },
  { id: "foundit", name: "Foundit", login: "https://www.foundit.in/rio/login" },
  { id: "wellfound", name: "Wellfound", login: "https://wellfound.com/login" }
];
const BOARD_DEFAULT_ON = { naukri: true, internshala: true, indeed: true, shine: true, hirist: true, instahyre: true, cutshort: true, foundit: false, wellfound: true };

let settings = { api: "", key: "", site: DEFAULT_SITE };
let current = { tabId: null, job: null, jobId: null, applicationId: null, pageBase: "", fields: new Map(), asks: [], saved: false };
let page = { status: "loading", job: null, hasForm: false };   // loading | none | job | form | access | error
let fill = null;                                                // last fill report on this tab
let st = { autoEnabled: false, autoState: {}, boardState: {}, serverAuto: null, autoDaily: null, autoLog: [], doneSeen: 0, access: { all: false, boards: false } };

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
function say(msg, kind = "", id = "msg") { const n = $(id); n.textContent = msg || ""; n.className = `msg ${kind}`; }
const site = () => settings.api || settings.site || DEFAULT_SITE;
const openWeb = (path) => chrome.tabs.create({ url: site() + path });
const signedIn = () => !!(settings.api && settings.key);
const istDayUI = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[data-web]"); if (a) { e.preventDefault(); openWeb(a.dataset.web); } });

// ───────── settings / account
async function loadSettings() {
  const s = await chrome.storage.local.get(["api", "key", "site", "resumeName", "resumeSyncedAt"]);
  settings = { api: s.api || "", key: s.key || "", site: s.site || s.api || DEFAULT_SITE };
  $("api").value = settings.api || settings.site; $("key").value = settings.key;
  $("resumeLine").textContent = s.resumeName ? `Resume for upload fields: synced from the website${s.resumeSyncedAt ? ` (${new Date(s.resumeSyncedAt).toLocaleDateString("en-IN")})` : ""}.` : "No resume synced yet. Upload one on the website.";
}
async function refreshAccount() {
  if (!signedIn()) { $("acctLine").textContent = "Not signed in."; return; }
  try { const me = await apiCall("/api/me", { method: "GET" }); $("acctLine").textContent = `Signed in as ${me.email || "your account"} · ${new URL(settings.api).host}`; st.me = me; }
  catch (e) { $("acctLine").textContent = e.message; }
}

// Sign in: open the website's pairing page; background.js receives the key and stores it.
function signIn() {
  const origin = (() => { try { return new URL(site()).origin; } catch { return DEFAULT_SITE; } })();
  const url = `${origin}/dashboard/extension/connect?ext=${chrome.runtime.id}`;
  const builtIn = origin === DEFAULT_SITE || /^http:\/\/localhost:3000$/.test(origin);
  const open = () => chrome.runtime.sendMessage({ type: "connect:open", url }).then(() => say("Finish signing in on the tab that just opened.")).catch((e) => say(String(e.message || e), "bad"));
  // A self-hosted site needs page access so the pairing relay can run there. Request it inside the click (user gesture).
  if (builtIn) return open();
  chrome.permissions.request({ origins: [`${origin}/*`] }).then(open, open);
}
$("signOut").addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.storage.local.remove(["key", "resumeB64", "resumeName", "resumeSyncedAt", "resumeUploadedAt"]);
  await chrome.runtime.sendMessage({ type: "auto:stop" }).catch(() => {});
  $("gearSheet").close(); say("Signed out. Your key still exists until you revoke it on the website.");
});
$("saveKey").addEventListener("click", async () => {
  let api = $("api").value.trim().replace(/\/+$/, "");
  const key = $("key").value.trim();
  try { const u = new URL(api); if (!/^https?:$/.test(u.protocol)) throw 0; api = u.origin; } catch { return say("Enter a valid site URL, e.g. https://applypilot-theta.vercel.app", "bad", "gearMsg"); }
  if (!/^ap_[A-Za-z0-9_-]{20,80}$/.test(key)) return say("That does not look like an ApplyPilot key (starts with ap_).", "bad", "gearMsg");
  const prev = settings; settings = { api, key, site: api };
  try { await apiCall("/api/me", { method: "GET" }); await chrome.storage.local.set({ api, key, site: api }); say("Connected", "ok", "gearMsg"); }
  catch (e) { settings = prev; say(e.message, "bad", "gearMsg"); }
});
$("gearBtn").addEventListener("click", async () => { say("", "", "gearMsg"); await refreshAccount(); renderAccessLine(); $("gearSheet").showModal(); });
$("gearClose").addEventListener("click", () => $("gearSheet").close());

// Resume: uploaded on the website, synced down for upload fields (autofill.js / boardpage.js read storage.resumeB64).
async function syncResume() {
  if (!signedIn()) return;
  try {
    const meta = await apiCall("/api/resume?meta=1", { method: "GET" });
    const { resumeUploadedAt } = await chrome.storage.local.get("resumeUploadedAt");
    if (resumeUploadedAt === meta.uploaded_at) return;
    const r = await fetch(settings.api + "/api/resume", { headers: { Authorization: `Bearer ${settings.key}` } });
    if (!r.ok) return;
    const blob = await r.blob();
    if (blob.size > 5 * 1024 * 1024) return;
    const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    await chrome.storage.local.set({ resumeB64: b64, resumeName: meta.name || "resume.pdf", resumeUploadedAt: meta.uploaded_at, resumeSyncedAt: Date.now() });
    loadSettings();
  } catch { /* no resume yet, or an older server: keep any locally saved copy */ }
}

// ───────── API
async function apiCall(path, { method = "POST", body } = {}) {
  if (!signedIn()) throw new Error("Sign in first.");
  let r;
  try {
    r = await fetch(settings.api + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.key}` }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("Could not reach ApplyPilot. Check your connection."); }
  let j = {}; try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401) throw new Error("Your sign-in expired or was revoked. Sign in again.");
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
const pageBaseOf = (url) => { try { const u = new URL(url); return u.origin + u.pathname.split("/").slice(0, 4).join("/"); } catch { return ""; } };
async function loadTabState(tabId) {
  const k = `tab:${tabId}`; const s = (await chrome.storage.session.get(k))[k] || {};
  current = { ...current, tabId, jobId: s.jobId || null, applicationId: s.applicationId || null, pageBase: s.pageBase || "" };
}
async function saveTabState() {
  if (current.tabId == null) return;
  await chrome.storage.session.set({ [`tab:${current.tabId}`]: { jobId: current.jobId, applicationId: current.applicationId, pageBase: current.pageBase } });
}

// ───────── state → status card (ONE primary button)
const running = () => !!(st.autoState.running || st.boardState.running);
const anyRunDone = () => {
  const b = st.boardState, a = st.autoState;
  const pick = [b, a].filter((x) => x && !x.running && x.startedAt && x.status === "stopped").sort((x, y) => y.startedAt - x.startedAt)[0];
  if (!pick || pick.startedAt <= st.doneSeen || Date.now() - pick.startedAt > 18 * 3600_000) return null;
  return { at: pick.startedAt, applied: (pick.applied ?? pick.submitted) || 0, review: pick.review || 0, skipped: pick.skipped || 0, message: pick.message || "" };
};
function boardConn() {
  const set = ((st.serverAuto || {}).settings || {}).boards || {};
  const conn = (st.serverAuto || {}).board_status || {};
  return BOARDS.map((b) => {
    const s = set[b.id] || {}; const on = typeof s.on === "boolean" ? s.on : BOARD_DEFAULT_ON[b.id];
    const c = conn[b.id]; return { ...b, on, connected: !c || c.connected == null ? null : !!c.connected };
  });
}
const nextRunLine = () => {
  const cfg = (st.serverAuto || {}).settings;
  const daily = st.autoDaily && st.autoDaily.day === istDayUI() ? st.autoDaily : { count: 0 };
  const cap = (cfg && cfg.daily_cap) || 20;
  const parts = [];
  if (!st.autoEnabled) parts.push("Auto is off");
  else if (cfg && cfg.enabled) parts.push(`Next auto run ${cfg.run_time} IST`);
  else parts.push("Daily run is off on the website");
  parts.push(`applied today ${daily.count || 0}/${cap}`);
  return parts.join(" · ");
};
function liveLine() {
  const b = st.boardState, a = st.autoState;
  if (b.running) {
    const name = (BOARDS.find((x) => x.id === b.board) || {}).name || "";
    const cur = b.current ? [b.current.company, b.current.title].filter(Boolean).join(" · ") : "";
    const wait = b.status === "waiting" && b.nextAt ? `Next in ${Math.max(0, Math.round((b.nextAt - Date.now()) / 1000))}s` : "";
    return { line: [wait || (b.status === "collecting" ? "Collecting jobs" : "Applying"), cur, name].filter(Boolean).join(" · "), done: b.applied || 0, total: b.queued || b.found || 0 };
  }
  const cur = a.current && a.current.app ? [a.current.app.company, a.current.app.title].filter(Boolean).join(" · ") : "";
  const wait = a.status === "waiting" && a.nextAt ? `Next in ${Math.max(0, Math.round((a.nextAt - Date.now()) / 1000))}s` : "";
  return { line: [wait || (a.status === "discovering" ? "Finding matching jobs" : `Applying ${(a.submitted || 0) + (a.skipped || 0) + 1}/${Math.max(a.total || 0, 1)}`), cur].filter(Boolean).join(" · "), done: (a.submitted || 0) + (a.skipped || 0), total: a.total || 0 };
}

let primaryAction = null;
function setPrimary(label, action, kind = "primary") {
  const b = $("primary"); b.hidden = !label; b.textContent = label || ""; b.className = `btn full ${kind}`; b.disabled = false; primaryAction = action;
}
function setLink(label, action) { const a = $("stLink"); a.hidden = !label; a.textContent = label || ""; a.onclick = label ? (e) => { e.preventDefault(); action(); } : null; }

function render() {
  const t = $("stTitle"), line = $("stLine");
  $("stChecklist").hidden = true; $("stProgress").hidden = true; setLink("");
  $("autoEnabled").checked = !!st.autoEnabled; $("autoDot").className = `sdot${st.autoEnabled ? " on" : ""}`;
  const boards = boardConn();

  if (!signedIn()) {
    t.textContent = "Sign in to ApplyPilot"; line.textContent = "Save jobs, see your match and fill forms in one click.";
    $("stChecklist").hidden = false; ["ck1", "ck2", "ck3"].forEach((id) => $(id).classList.remove("done"));
    setPrimary("Sign in", signIn);
  } else if (running()) {
    const l = liveLine(); t.textContent = "Running"; line.textContent = l.line;
    $("stProgress").hidden = !l.total; $("stBar").style.width = l.total ? `${Math.min(100, Math.round((l.done / l.total) * 100))}%` : "0";
    setPrimary("Stop", stopAll, "stop");
  } else if (fill) {
    t.textContent = `Filled ${fill.filled} · ${fill.asks.length} need you`;
    line.textContent = fill.submitFound ? "Check everything, then click the outlined button yourself." : "Check everything before you submit.";
    setPrimary(current.applicationId ? "Mark submitted" : "Review on dashboard", current.applicationId ? markSubmitted : () => openWeb("/dashboard/tracker"));
    if (current.applicationId) setLink("Review on dashboard", () => openWeb("/dashboard/tracker"));
  } else if (page.status === "access") {
    t.textContent = "Allow access"; line.textContent = "ApplyPilot can't read this tab yet. Allow it once (it still only acts when you click). Chrome's own pages can't be read.";
    setPrimary("Allow access", () => requestAccess(ALL_SITES));
  } else if (page.status === "form") {
    t.textContent = page.job ? "Application form" : "Form on this page"; line.textContent = "Fills what your profile can answer. You click Submit.";
    setPrimary("Fill this page", doFill);
  } else if (page.status === "job") {
    t.textContent = current.saved ? "Saved to your tracker" : "Job post"; line.textContent = current.saved ? "Open the apply form and press Fill this page." : "Save it to track it and apply later, or let Auto apply.";
    setPrimary(current.saved ? "Saved" : "Save job", saveJob); if (current.saved) $("primary").disabled = true;
  } else if (anyRunDone()) {
    const d = anyRunDone(); t.textContent = `Applied ${d.applied} · ${d.review} to review`; line.textContent = d.message || "Run finished.";
    setPrimary("Review on dashboard", async () => { await chrome.storage.local.set({ doneSeen: d.at }); openWeb("/dashboard/tracker"); });
    setLink("Dismiss", () => chrome.storage.local.set({ doneSeen: d.at }));
  } else if (st.autoEnabled && !st.access.boards) {
    t.textContent = "Allow access"; line.textContent = "Auto mode opens job pages in a background tab and needs site access. All sites is recommended: employers use many domains.";
    setPrimary("Allow access", () => requestAccess(ALL_SITES));
  } else if (st.autoEnabled && boards.some((b) => b.on) && boards.filter((b) => b.on).every((b) => b.connected === false)) {
    t.textContent = "Connect boards"; line.textContent = "Sign in to your job boards in this Chrome so Auto can apply there.";
    setPrimary("Connect boards", () => boards.filter((b) => b.on && b.connected === false).forEach((b) => chrome.tabs.create({ url: b.login })));
  } else {
    t.textContent = st.autoEnabled ? "Ready" : "Ready when you are"; line.textContent = nextRunLine();
    setPrimary("Run now", runNow);
  }
  renderContext(); renderChips(boards); renderRecent();
}
$("primary").addEventListener("click", () => { if (primaryAction) primaryAction(); });

// ───────── context card
function renderContext() {
  const showJob = signedIn() && !fill && page.job && (page.status === "job" || page.status === "form");
  const showForm = signedIn() && !fill && page.status === "form" && !page.job;
  const showReport = signedIn() && !!fill;
  $("jobView").hidden = !showJob; $("formView").hidden = !showForm; $("reportView").hidden = !showReport;
  $("ctxCard").hidden = !(showJob || showForm || showReport);
  $("saveJobSecondary").hidden = !(showJob && page.status === "form") || current.saved;
  if (showReport) {
    $("reportTitle").textContent = [fill.res.title, fill.res.company].filter(Boolean).join(" at ") || "This form";
    $("reportNote").textContent = `${fill.asks.length ? "Click a field to jump to it." : "Nothing left for you."} ${fill.res.counted ? "Counted as 1 autofill this month." : "Same application as before: not counted again."}`;
    const list = $("askList"); clear(list);
    fill.asks.slice(0, 25).forEach((a) => {
      const f = current.fields.get(a.id);
      list.append(el("button", { class: "ask", type: "button", onclick: () => jumpTo(a.id) }, [el("b", { text: (f && f.label) || "Field" }), el("span", { text: a.reason || "Needs you" })]));
    });
  }
}
function setRing(v) {
  const ring = $("ring"); const val = Math.max(0, Math.min(100, Math.round(v)));
  ring.style.setProperty("--v", String(val));
  ring.style.setProperty("--c", val >= 75 ? "var(--ok)" : val >= 50 ? "var(--brand)" : val >= 30 ? "var(--warn)" : "var(--bad)");
  ring.setAttribute("aria-valuenow", String(val)); $("ringVal").textContent = String(val);
}
async function jumpTo(id) {
  try {
    await exec(current.tabId, { func: (fid) => { const n = document.querySelector(`[data-ap-id="${CSS.escape(fid)}"]`); if (!n) return false; n.scrollIntoView({ block: "center", behavior: "smooth" }); try { n.focus({ preventScroll: true }); } catch { /* not focusable */ } return true; }, args: [id] }, true);
  } catch { /* field gone */ }
}

// ───────── detect (runs on page load / tab switch; no Detect button)
let detecting = false;
async function detect() {
  if (detecting) return; detecting = true;
  $("fitOut").hidden = true; $("coverOut").hidden = true;
  try {
    const tab = await activeTab();
    if (tab.id !== current.tabId) { fill = null; current.saved = false; }
    await loadTabState(tab.id);
    const [res] = await exec(tab.id, { files: ["detect.js"] });
    const job = res && res.result;
    const base = pageBaseOf(job && job.url || "");
    if (current.pageBase && base !== current.pageBase) { current.jobId = null; current.applicationId = null; fill = null; current.saved = false; }
    current.pageBase = base; await saveTabState();
    current.job = job && job.found ? job : null;
    // detect.js's hasForm is true for any form (site search bars too). Count application-like fields before offering Fill.
    let appForm = false;
    if (job && job.hasForm) {
      try {
        const [f] = await exec(tab.id, { func: () => {
          const els = [...document.querySelectorAll("form input, form textarea, form select")].filter((n) => {
            if (/^(hidden|search|submit|button|image|reset)$/i.test(n.type || "")) return false;
            if (n.closest("header, nav, [role=search], form[role=search], form[action*=search i]")) return false;
            const r = n.getBoundingClientRect(); return r.width > 0 || n.type === "file";
          });
          return els.length >= 3 || els.some((n) => n.type === "file" || n.tagName === "TEXTAREA");
        } });
        appForm = !!(f && f.result);
      } catch { appForm = false; }
    }
    page = { status: appForm ? "form" : current.job ? "job" : "none", job: current.job, hasForm: appForm };
    render();
    if (current.job) scoreJob(current.job);
  } catch (e) {
    page = { status: e.message === NEED_ACCESS ? "access" : "none", job: null, hasForm: false }; current.job = null; render();
  } finally { detecting = false; }
  consumeFabAction();
}
async function scoreJob(job) {
  $("jobTitle").textContent = job.title;
  $("jobCompany").textContent = [job.company, job.location, job.remote ? "Remote" : ""].filter(Boolean).join(" · ");
  setRing(0); $("ringVal").textContent = "…"; $("scoreNote").textContent = "";
  if (!signedIn()) return;
  if ((job.description || "").length < 40) { $("ringVal").textContent = "–"; $("scoreNote").textContent = "Not enough description text to score."; return; }
  try {
    const s = await apiCall("/api/score", { body: { title: job.title, description: job.description } });
    setRing(s.score);
    const miss = (s.missing || []).slice(0, 3);
    $("scoreNote").textContent = `${s.matched.length}/${s.total} keywords${miss.length ? ` · missing: ${miss.join(", ")}` : ""}`;
  } catch (e) { $("ringVal").textContent = "–"; $("scoreNote").textContent = e.message; }
}

// ───────── actions
async function ensureJob(track = false) {
  if (!current.job) throw new Error("No job detected on this page.");
  if (current.jobId && !track) return current.jobId;
  const j = current.job;
  const r = await apiCall("/api/jobs", { body: { job: { title: j.title, company: j.company, location: j.location, remote: j.remote, description: j.description, apply_url: j.url, posted_at: j.posted_at, salary: j.salary, source: "extension" }, track } });
  current.jobId = r.job.id; if (r.applicationId) current.applicationId = r.applicationId;
  await saveTabState();
  return current.jobId;
}
async function withBusy(btn, label, fn) {
  const kids = [...btn.childNodes]; btn.textContent = label; btn.disabled = true;
  try { await fn(); } catch (e) { say(e.message === NEED_ACCESS ? "ApplyPilot can't read this tab. Use Allow access." : e.message, "bad"); }
  if (btn === $("primary")) render(); else { btn.replaceChildren(...kids); btn.disabled = false; }
}
function saveJob(btn = $("primary")) {
  return withBusy(btn, "Saving…", async () => { await ensureJob(true); current.saved = true; say("Saved to your tracker", "ok"); render(); });
}
$("saveJobSecondary").addEventListener("click", (e) => saveJob(e.currentTarget));

function doFill() {
  const btn = $("primary");
  return withBusy(btn, "Reading the form…", async () => {
    say("");
    const tab = await activeTab(); await loadTabState(tab.id);
    await exec(tab.id, { files: ["autofill.js"] }, true);
    const frames = await exec(tab.id, { func: () => (window.__AP ? window.__AP.collect() : null) }, true);
    const fields = []; let url = "", title = "";
    for (const f of frames) { const r = f.result; if (!r) continue; fields.push(...r.fields); if (r.top || !url) { url = r.url; title = r.title; } }
    if (!fields.length) throw new Error("No form fields found. Open the application form first.");
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
    fill = { filled, asks, submitFound, res };
  });
}

// Answers the user typed into the orange fields are saved on their own when they mark the application submitted.
async function autoSaveAnswers() {
  const ids = current.asks.filter((a) => { const f = current.fields.get(a.id); return f && f.type !== "file"; }).map((a) => a.id);
  if (!ids.length || current.tabId == null) return 0;
  try {
    const frames = await exec(current.tabId, { func: (list) => (window.__AP ? window.__AP.readAnswers(list) : []), args: [ids] }, true);
    const answers = frames.flatMap((f) => f.result || []).filter((x) => x && x.q && x.a);
    if (!answers.length) return 0;
    const r = await apiCall("/api/answers", { body: { answers } });
    return r.saved || 0;
  } catch { return 0; }
}
function markSubmitted() {
  return withBusy($("primary"), "Updating…", async () => {
    const saved = await autoSaveAnswers();
    await apiCall("/api/applications", { body: { id: current.applicationId, status: "applied" } });
    current.applicationId = null; current.jobId = null; fill = null; await saveTabState();
    say(`Tracked as applied.${saved ? ` Saved ${saved} new answer${saved === 1 ? "" : "s"} to your answer bank (edit them on the website).` : ""} Good luck!`, "ok");
    render();
  });
}

// AI tools menu: Tailor opens the website; Cover letter and Fit show inline.
const aiMenu = $("aiMenu");
function toggleMenu(open) { aiMenu.hidden = !open; $("aiBtn").setAttribute("aria-expanded", String(open)); if (open) aiMenu.querySelector("button").focus(); }
$("aiBtn").addEventListener("click", () => toggleMenu(aiMenu.hidden));
document.addEventListener("click", (e) => { if (!aiMenu.hidden && !e.target.closest(".menu-wrap")) toggleMenu(false); });
aiMenu.addEventListener("keydown", (e) => {
  const items = [...aiMenu.querySelectorAll("button")]; const i = items.indexOf(document.activeElement);
  if (e.key === "Escape") { toggleMenu(false); $("aiBtn").focus(); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
});
aiMenu.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ai]"); if (!b) return;
  toggleMenu(false); const btn = $("aiBtn");
  if (b.dataset.ai === "tailor") return withBusy(btn, "Opening…", async () => { const id = await ensureJob(); openWeb(`/dashboard/tailor?job=${encodeURIComponent(id)}`); });
  if (b.dataset.ai === "cover") return withBusy(btn, "Writing…", async () => {
    const id = await ensureJob(); const r = await apiCall("/api/cover-letter", { body: { jobId: id } });
    $("coverText").value = r.cover_letter; updateWords(); $("coverOut").hidden = false; $("fitOut").hidden = true;
  });
  if (b.dataset.ai === "fit") return withBusy(btn, "Analysing…", async () => {
    const id = await ensureJob(); const m = await apiCall("/api/match", { body: { jobId: id } });
    const out = $("fitOut"); clear(out); out.hidden = false; $("coverOut").hidden = true;
    out.append(el("h3", { text: `AI fit: ${m.fit_score}/100` }), el("p", { class: "small", text: m.verdict || "" }));
    if (m.reasons && m.reasons.length) out.append(el("ul", { class: "small" }, m.reasons.map((r) => el("li", { text: r }))));
    if (m.gaps && m.gaps.length) out.append(el("p", { class: "small muted", text: "Gaps:" }), el("ul", { class: "small" }, m.gaps.map((r) => el("li", { text: r }))));
  });
});
function updateWords() { const n = ($("coverText").value.trim().match(/\S+/g) || []).length; $("coverWords").textContent = `${n} words`; }
$("coverText").addEventListener("input", updateWords);
$("copyCover").addEventListener("click", async (e) => {
  e.preventDefault();
  try { await navigator.clipboard.writeText($("coverText").value); say("Copied", "ok"); } catch { say("Copy failed. Select the text and copy.", "bad"); }
});

// ───────── access (ONE prompt; must start synchronously inside the click = user gesture)
function requestAccess(origins) {
  chrome.permissions.request({ origins }).then((ok) => { say(ok ? "Access allowed. ApplyPilot still only acts when you click or when Auto is on." : "Not allowed.", ok ? "ok" : "bad"); refreshAccess().then(detect); })
    .catch((e) => say(String(e.message || e), "bad"));
}
async function refreshAccess() {
  const all = await chrome.permissions.contains({ origins: ALL_SITES });
  st.access = { all, boards: all || await chrome.permissions.contains({ origins: JOB_SITES.filter((o) => !/linkedin/.test(o)) }) };
}
function renderAccessLine() {
  const n = $("accessLine"); clear(n);
  n.append(st.access.all ? "Site access: all sites." : st.access.boards ? "Site access: job boards only. " : "Site access: not allowed yet. ");
  if (!st.access.all) n.append(el("a", { href: "#", text: "Allow on all sites", onclick: (e) => { e.preventDefault(); requestAccess(ALL_SITES); } }));
}

// ───────── Auto (runners live in the service worker)
$("autoEnabled").addEventListener("change", async (e) => {
  const on = e.currentTarget.checked;
  if (on) {
    e.currentTarget.checked = false;
    const { autoConfirmed } = await chrome.storage.local.get("autoConfirmed");
    if (!autoConfirmed) { pendingRun = false; $("autoSheet").showModal(); return; }
  }
  await chrome.storage.local.set({ autoEnabled: on });
});
let pendingRun = false;
$("autoCancel").addEventListener("click", () => { pendingRun = false; $("autoSheet").close(); });
$("autoConfirm").addEventListener("click", async () => {
  $("autoSheet").close(); await chrome.storage.local.set({ autoEnabled: true, autoConfirmed: true });
  if (pendingRun) { pendingRun = false; startRun("board"); }
});
async function runNow() {
  if (!st.autoEnabled) {
    const { autoConfirmed } = await chrome.storage.local.get("autoConfirmed");
    if (!autoConfirmed) { pendingRun = true; $("autoSheet").showModal(); return; }
    await chrome.storage.local.set({ autoEnabled: true });
  }
  startRun("board");
}
// "Run now" runs the board recommendations runner when any board is on, otherwise the saved-jobs queue (+ discovery).
async function startRun(kind) {
  const btn = $("primary");
  await withBusy(btn, "Starting…", async () => {
    const useBoards = kind === "board" && boardConn().some((b) => b.on);
    if (!useBoards) { await refreshAccess(); if (!st.access.boards) throw new Error("Allow site access first (all sites recommended)."); }
    const r = await chrome.runtime.sendMessage({ type: useBoards ? "board:start" : "auto:start" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not start.");
    say("Started. Jobs open in a background tab; keep Chrome open.", "ok");
  });
  refreshAuto();
}
$("runSaved").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!signedIn()) return say("Sign in first.", "bad");
  if (!st.autoEnabled) { say("Turn Auto on first (switch at the top).", "bad"); return; }
  if (running()) return say("A run is already going.", "bad");
  startRun("saved");
});
async function stopAll() {
  try { await chrome.runtime.sendMessage({ type: "auto:stop" }); say("Stopped."); } catch (err) { say(String(err.message || err), "bad"); }
  refreshAuto();
}

// ───────── board chips + recent
function renderChips(boards) {
  const box = $("boardChips"); clear(box);
  for (const b of boards) {
    const cls = !b.on ? "off" : b.connected === true ? "ok" : b.connected === false ? "warn" : "";
    const title = !b.on ? `${b.name}: off (turn it on in Auto-apply settings)` : b.connected === true ? `${b.name}: signed in` : b.connected === false ? `${b.name}: needs sign-in. Click to open the login page.` : `${b.name}: sign-in not checked yet`;
    box.append(el("button", { class: `chip ${cls}`, type: "button", title, "aria-label": title, onclick: () => {
      if (!b.on) return openWeb("/dashboard/auto");
      chrome.tabs.create({ url: b.login });
    } }, [el("span", { class: "d" }), b.name]));
  }
}
function renderRecent() {
  const ol = $("recent"); clear(ol);
  const items = (st.autoLog || []).slice(0, 5);
  if (!items.length) { ol.append(el("li", { class: "empty", text: "No activity yet." })); return; }
  for (const x of items) {
    const t = new Date(x.t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    ol.append(el("li", { title: x.text || "" }, [el("time", { text: t }), el("span", { class: x.kind || "", text: x.text || "" })]));
  }
}

async function refreshAuto() {
  const d = await chrome.storage.local.get(["autoEnabled", "autoState", "boardState", "serverAuto", "autoDaily", "autoLog", "doneSeen"]);
  st = { ...st, autoEnabled: !!d.autoEnabled, autoState: d.autoState || {}, boardState: d.boardState || {}, serverAuto: d.serverAuto || null, autoDaily: d.autoDaily || null, autoLog: d.autoLog || [], doneSeen: d.doneSeen || 0 };
  render();
}

// ───────── in-page button: open panel + run the page's primary action
async function consumeFabAction() {
  const { fabAction } = await chrome.storage.session.get("fabAction");
  if (!fabAction || fabAction.tabId !== current.tabId || Date.now() - fabAction.at > 15000) return;
  await chrome.storage.session.remove("fabAction");
  if (!signedIn()) return;
  if (page.status === "form") doFill(); else if (page.status === "job" && !current.saved) saveJob();
}
chrome.storage.session.onChanged.addListener((c) => { if (c.fabAction && c.fabAction.newValue && !detecting) detect(); });

// ───────── live updates
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local") return;
  if (c.key || c.api) loadSettings().then(() => { if (c.key && c.key.newValue && !c.key.oldValue) { say("Signed in", "ok"); syncResume(); chrome.runtime.sendMessage({ type: "board:settings" }).catch(() => {}); detect(); } render(); });
  if (c.autoState || c.boardState || c.serverAuto || c.autoDaily || c.autoLog || c.autoEnabled || c.doneSeen) refreshAuto();
  if (c.resumeName) loadSettings();
});
setInterval(() => { if (running()) refreshAuto(); }, 2000); // keeps the "next in Ns" countdown fresh
let detectTimer = null;
const scheduleDetect = () => { clearTimeout(detectTimer); detectTimer = setTimeout(detect, 400); };
chrome.tabs.onActivated.addListener(scheduleDetect);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === "complete" && tabId === current.tabId) scheduleDetect(); });
chrome.permissions.onAdded.addListener(() => refreshAccess().then(render));

(async () => {
  await loadSettings(); await refreshAccess(); await refreshAuto();
  detect();
  if (signedIn()) { chrome.runtime.sendMessage({ type: "board:settings" }).then(refreshAuto).catch(() => {}); syncResume(); }
})();

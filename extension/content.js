// ApplyPilot content script: read form -> ask API -> fill -> highlight.
// "Fill this page" never submits. "One-click Apply" walks quick-apply flows (LinkedIn Easy Apply,
// Naukri, Indeed and simple multi-step forms) and submits only when the user turned on Auto-submit.
(() => {
  if (window.__applypilot) return; window.__applypilot = true;

  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 200);

  function labelFor(el) {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return clean(l.innerText); }
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(" ").map((i) => document.getElementById(i)?.innerText || "").join(" "));
    const wrap = el.closest("label"); if (wrap) return clean(wrap.innerText);
    const fs = el.closest("fieldset")?.querySelector("legend"); if (fs) return clean(fs.innerText);
    let n = el; for (let i = 0; i < 4 && n; i++) { n = n.parentElement; const t = n?.querySelector("label, legend, span, p"); if (t && clean(t.innerText)) return clean(t.innerText); }
    return clean(el.placeholder || el.name || el.id);
  }

  let seq = 0; // field ids stay unique across steps
  function collect(root = document) {
    const fields = [], seenRadio = new Set(); let i = seq;
    root.querySelectorAll("input, textarea, select, [contenteditable=true]").forEach((el) => {
      if (el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
        if (!visible(el) || clean(el.innerText)) return;
        const id = `ap${i++}`; el.dataset.apId = id;
        fields.push({ id, label: labelFor(el) || lastQuestion(root), type: "textarea" }); return;
      }
      const type = (el.type || el.tagName).toLowerCase();
      if (["hidden", "submit", "button", "search", "password", "image", "reset"].includes(type) || el.disabled) return;
      if (type !== "file" && !visible(el)) return;
      if (type === "radio") {
        if (!el.name || seenRadio.has(el.name)) return; seenRadio.add(el.name);
        const group = [...root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        const id = `ap${i++}`; group.forEach((g) => (g.dataset.apId = id));
        const q = el.closest("fieldset")?.querySelector("legend")?.innerText || labelFor(el.closest("fieldset") || el.parentElement?.parentElement || el);
        fields.push({ id, label: clean(q), type: "radio", options: group.map(labelFor), required: el.required });
        return;
      }
      const id = `ap${i++}`; el.dataset.apId = id;
      const f = { id, label: labelFor(el), type, required: el.required || el.getAttribute("aria-required") === "true" };
      if (el.tagName === "SELECT") f.options = [...el.options].map((o) => clean(o.text)).filter(Boolean).slice(0, 60);
      if (el.value && type !== "file" && type !== "checkbox") f.current = clean(el.value);
      fields.push(f);
    });
    seq = i;
    return fields;
  }

  // Naukri's chatbot asks one question at a time as a chat bubble above the input.
  function lastQuestion(root) {
    const bubbles = [...root.querySelectorAll('[class*="botMsg"], [class*="bot-msg"], [class*="botItem"], li')].filter(visible);
    return clean(bubbles.at(-1)?.innerText || "");
  }

  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function uploadResume(el) {
    const { resumeB64, resumeName } = await chrome.storage.local.get(["resumeB64", "resumeName"]);
    if (!resumeB64) return false;
    const blob = await (await fetch(resumeB64)).blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], resumeName || "resume.pdf", { type: "application/pdf" }));
    el.files = dt.files; el.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }

  const mark = (el, color, tip) => { if (!el) return; el.style.outline = `3px solid ${color}`; el.style.outlineOffset = "2px"; if (tip) el.title = tip; };

  async function apply(actions) {
    let filled = 0; const asks = [];
    for (const a of actions) {
      const els = [...document.querySelectorAll(`[data-ap-id="${a.id}"]`)]; const el = els[0]; if (!el) continue;
      try {
        if (a.action === "ask_user") { asks.push(a); mark(el, "#ff9f1c", `ApplyPilot: please answer (${a.reason || "needs you"})`); continue; }
        if (a.action === "upload_resume") { if (await uploadResume(el)) { filled++; mark(el.parentElement || el, "#2ecc71"); } else asks.push({ ...a, reason: "save your resume in the extension" }); continue; }
        if (el.type === "radio") {
          const pick = els.find((r) => labelFor(r).toLowerCase() === String(a.value).toLowerCase()) || els.find((r) => labelFor(r).toLowerCase().includes(String(a.value).toLowerCase()));
          if (pick) { pick.click(); filled++; mark(pick.parentElement, "#2ecc71"); } else asks.push(a); continue;
        }
        if (el.type === "checkbox") { const want = String(a.value) === "true"; if (el.checked !== want) el.click(); filled++; mark(el, "#2ecc71"); continue; }
        if (el.tagName === "SELECT") {
          const opt = [...el.options].find((o) => clean(o.text).toLowerCase() === String(a.value).toLowerCase()) || [...el.options].find((o) => clean(o.text).toLowerCase().includes(String(a.value).toLowerCase()));
          if (opt) { setNative(el, opt.value); filled++; mark(el, "#2ecc71"); } else asks.push(a); continue;
        }
        if (el.isContentEditable && a.value) { el.focus(); el.textContent = String(a.value); el.dispatchEvent(new InputEvent("input", { bubbles: true })); filled++; mark(el, "#2ecc71"); continue; }
        if (a.value != null && a.value !== "") { setNative(el, String(a.value)); filled++; mark(el, "#2ecc71"); }
      } catch { asks.push(a); }
    }
    return { filled, asks };
  }

  function highlightSubmit() {
    const btn = [...document.querySelectorAll("button, input[type=submit]")].filter(visible)
      .find((b) => /submit|apply|send application|review|next|continue/i.test(b.innerText || b.value));
    if (btn) { mark(btn, "#4f7cff", "ApplyPilot: review the form, then click this yourself"); btn.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  function panel(info) {
    document.getElementById("ap-panel")?.remove();
    const d = document.createElement("div"); d.id = "ap-panel";
    d.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#141a2a;color:#e8ecf4;border:1px solid #33405e;border-radius:12px;padding:14px;width:300px;font:13px system-ui;box-shadow:0 8px 30px #0008";
    d.innerHTML = `<b>ApplyPilot</b> · ${info.company || ""} ${info.title ? "– " + info.title : ""}<br>
      ✅ Filled ${info.filled} fields<br>🟧 ${info.asks.length} need you${info.asks.length ? ":<ul style='margin:4px 0;padding-left:18px'>" + info.asks.slice(0, 6).map((a) => `<li>${a.reason || a.id}</li>`).join("") + "</ul>" : "<br>"}
      Check everything, then click the blue-outlined button yourself.<br>
      <button id="ap-sub" style="margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:#2ecc71;color:#08130c;font-weight:700;cursor:pointer">I submitted it</button>
      <button id="ap-x" style="margin-top:6px;width:100%;padding:6px;border:1px solid #33405e;border-radius:8px;background:none;color:#e8ecf4;cursor:pointer">Close</button>`;
    document.body.appendChild(d);
    d.querySelector("#ap-x").onclick = () => d.remove();
    d.querySelector("#ap-sub").onclick = () => chrome.runtime.sendMessage({ type: "AP_API", path: "/api/applications", body: { id: info.applicationId, status: "applied" } },
      (r) => { d.querySelector("#ap-sub").textContent = r?.error ? r.error : "Tracked as submitted ✓"; });
  }


  // ---- Read the job on the current page (read-only; used by "Save job", "Find HR", "Write referral note") ----
  const txt = (sel) => { for (const s of sel) { const el = document.querySelector(s); if (el && clean(el.innerText)) return clean(el.innerText); } return ""; };

  function jsonLdJob() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent || "null");
        const items = Array.isArray(data) ? data : data && data["@graph"] ? data["@graph"] : [data];
        const j = items.find((x) => x && (x["@type"] === "JobPosting" || (Array.isArray(x["@type"]) && x["@type"].includes("JobPosting"))));
        if (j) return j;
      } catch { /* ignore bad JSON-LD */ }
    }
    return null;
  }

  // LinkedIn "Meet the hiring team" / job poster card. Only reads what is already on screen.
  function hiringTeam() {
    const people = []; const seen = new Set();
    const roots = [...document.querySelectorAll(".hirer-card__hirer-information, .job-details-people-who-can-help__section--two-pane, .job-details-people-who-can-help__section, .jobs-poster")];
    const heading = [...document.querySelectorAll("h2, h3, span")].find((h) => /meet the hiring team|people you can reach out to|job poster/i.test(h.innerText || ""));
    if (heading) roots.push(heading.closest("section, .artdeco-card, div") || heading.parentElement);
    roots.filter(Boolean).forEach((root) => {
      root.querySelectorAll('a[href*="/in/"]').forEach((a) => {
        const href = a.href.split("?")[0];
        if (seen.has(href)) return;
        const name = clean((a.querySelector("strong, .jobs-poster__name, span[aria-hidden=true]") || a).innerText).split(/\n|·/)[0].replace(/\s*(1st|2nd|3rd\+?)\s*$/i, "").trim();
        if (!name || name.length > 60 || /view|profile|message/i.test(name)) return;
        seen.add(href);
        const card = a.closest("li, .hirer-card__hirer-information, div");
        const title = clean(card?.querySelector(".hirer-card__job-poster, .text-body-small, .linked-area .t-14")?.innerText || "");
        people.push({ name, title: title !== name ? title : "", profileUrl: href });
      });
    });
    return people.slice(0, 5);
  }

  function readJob() {
    const ld = jsonLdJob();
    const isLinkedIn = /linkedin\.com$/.test(location.hostname);
    const title = (isLinkedIn && txt([".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", "h1.t-24"]))
      || clean(ld?.title) || txt(["h1"]) || clean(document.querySelector('meta[property="og:title"]')?.content) || clean(document.title);
    const company = (isLinkedIn && txt([".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name"]))
      || clean(ld?.hiringOrganization?.name) || clean(document.querySelector('meta[property="og:site_name"]')?.content);
    const loc = ld?.jobLocation ? [].concat(ld.jobLocation).map((l) => [l?.address?.addressLocality, l?.address?.addressCountry?.name || l?.address?.addressCountry].filter(Boolean).join(", ")).join("; ") : "";
    const location_ = (isLinkedIn && txt([".job-details-jobs-unified-top-card__primary-description-container .tvm__text", ".job-details-jobs-unified-top-card__bullet", ".jobs-unified-top-card__bullet"])) || loc;
    const descEl = document.querySelector("#job-details, .jobs-description__content, .jobs-box__html-content, [data-testid=job-description], .job-description, #content .section-wrapper");
    let description = descEl ? descEl.innerText : "";
    if (!description && ld?.description) { const d = document.createElement("div"); d.innerHTML = ld.description; description = d.innerText; }
    let domain = "";
    const orgUrl = ld?.hiringOrganization?.sameAs || ld?.hiringOrganization?.url;
    try { if (orgUrl) domain = new URL(orgUrl).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    return {
      url: location.href.split("#")[0], title, company, location: location_,
      description: (description || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000),
      hiringTeam: isLinkedIn ? hiringTeam() : [], domain
    };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== "AP_READ_JOB") return;
    if (window !== window.top) return; // only the main page answers
    reply(readJob());
  });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== "AP_FILL") return;
    if (window !== window.top && !document.querySelector("input, textarea, select")) return;
    const fields = collect();
    if (!fields.length) { reply({ message: "No form fields found on this page." }); return; }
    chrome.runtime.sendMessage({ type: "AP_API", path: "/api/agent", body: { url: location.href, pageTitle: document.title, fields } }, async (res) => {
      if (!res || res.error) return reply({ message: res?.error || "API error" });
      const { filled, asks } = await apply(res.actions || []);
      highlightSubmit(); panel({ ...res, filled, asks });
      reply({ message: `Filled ${filled}. ${asks.length} need you. Review, then click Submit yourself.` });
    });
    return true;
  });
  // ---------------- One-click Apply ----------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const human = () => sleep(700 + Math.random() * 900); // human pace between steps, keeps accounts safe
  const callApi = (path, body, method) => new Promise((res) => chrome.runtime.sendMessage({ type: "AP_API", path, body, method }, res));
  const bText = (b) => clean(b.innerText || b.value || b.getAttribute("aria-label") || "");
  const buttons = (root) => [...root.querySelectorAll("button, input[type=submit], a[role=button]")].filter(visible).filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const findBtn = (root, re, not) => buttons(root).find((b) => re.test(bText(b)) && !(not && not.test(bText(b))));
  async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(300); } return null; }
  const pageHas = (re, root = document.body) => re.test(root.innerText || "");
  const host = location.hostname;
  const site = /linkedin\.com$/.test(host) ? "linkedin" : /naukri\.com$/.test(host) ? "naukri" : /indeed\./.test(host) ? "indeed" : "generic";

  let qp = null;
  function qpanel(html, buttonsHtml = "") {
    if (!qp || !document.body.contains(qp)) {
      qp = document.createElement("div"); qp.id = "ap-qp";
      qp.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#141a2a;color:#e8ecf4;border:1px solid #33405e;border-radius:12px;padding:14px;width:300px;font:13px system-ui;box-shadow:0 8px 30px #0008";
      document.body.appendChild(qp);
    }
    qp.innerHTML = `<b>ApplyPilot · One-click Apply</b><div style="margin-top:6px">${html}</div>${buttonsHtml}
      <button data-qp="x" style="margin-top:6px;width:100%;padding:6px;border:1px solid #33405e;border-radius:8px;background:none;color:#e8ecf4;cursor:pointer">Close</button>`;
    qp.querySelector('[data-qp="x"]').onclick = () => { stopFlag = true; qp.remove(); };
    return qp;
  }
  const bigBtn = (id, label, color = "#4f7cff") => `<button data-qp="${id}" style="margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:${color};color:#fff;font-weight:700;cursor:pointer">${label}</button>`;

  let appId = null, stopFlag = false, running = false;

  async function track(status) {
    if (!appId) {
      const r = await callApi("/api/applications", { action: "save", source: "one-click", job: readJob() });
      appId = r?.id || null;
    }
    if (appId) await callApi("/api/applications", { id: appId, status });
  }

  async function fillStep(root) {
    const fields = collect(root).filter((f) => !(f.current && f.required !== true && f.type !== "select"));
    if (!fields.length) return { filled: 0, asks: [] };
    const res = await callApi("/api/agent", { url: location.href.split("#")[0], pageTitle: document.title, fields, applicationId: appId || undefined });
    if (!res || res.error) throw new Error(res?.error || "API error");
    appId = res.applicationId || appId;
    return apply(res.actions || []);
  }

  function needYou(asks, why) {
    const list = asks.length ? "<ul style='margin:4px 0;padding-left:18px'>" + asks.slice(0, 6).map((a) => `<li>${a.reason || a.label || a.id}</li>`).join("") + "</ul>" : "";
    const p = qpanel(`🟧 ${why || "A few answers need you"}:${list}Answer the orange fields, then press Continue.`, bigBtn("go", "Continue"));
    p.querySelector('[data-qp="go"]').onclick = () => quickApply();
  }

  async function finishedOk() {
    await track("applied");
    const { apCount = {} } = await chrome.storage.local.get("apCount");
    const day = new Date().toISOString().slice(0, 10); apCount[day] = (apCount[day] || 0) + 1;
    chrome.storage.local.set({ apCount: { [day]: apCount[day] } });
    qpanel(`✅ Applied! Tracked in your ApplyPilot tracker. (${apCount[day]} today)`);
  }

  async function atSubmit(btn, autoSubmit, root) {
    if (!autoSubmit) {
      mark(btn, "#4f7cff", "ApplyPilot: review, then submit");
      btn.scrollIntoView({ block: "center", behavior: "smooth" });
      const p = qpanel("📝 All steps filled. Review the last screen, then submit.", bigBtn("sub", "Submit now", "#2ecc71"));
      p.querySelector('[data-qp="sub"]').onclick = async () => { btn.click(); await afterSubmit(root); };
      await track("filled");
      return;
    }
    await human(); btn.click(); await afterSubmit(root);
  }

  async function afterSubmit(root) {
    const ok = await waitFor(() => pageHas(/application (was )?sent|successfully applied|application submitted|you applied|thank you for applying|applied successfully|your application has been/i), 10000);
    if (ok) return finishedOk();
    const err = root && document.body.contains(root) && root.querySelector('.artdeco-inline-feedback--error, [role=alert], .error, [aria-invalid=true]');
    if (err) return needYou([], "The site flagged something before submitting");
    qpanel("Submitted. I couldn't see a confirmation message, so check the page.", bigBtn("ok", "Mark as applied", "#2ecc71"))
      .querySelector('[data-qp="ok"]').onclick = finishedOk;
  }

  // Walks a multi-step form inside `getRoot()` until the final submit button.
  async function stepLoop(getRoot, nextRe, submitRe, autoSubmit) {
    let lastSig = "";
    for (let step = 1; step <= 15 && !stopFlag; step++) {
      const root = getRoot(); if (!root) return qpanel("The application window closed.");
      qpanel(`Step ${step}: filling…`);
      const { filled, asks } = await fillStep(root);
      if (asks.length) return needYou(asks);
      await human();
      const submit = findBtn(root, submitRe);
      if (submit) return atSubmit(submit, autoSubmit, root);
      const next = findBtn(root, nextRe, /back|previous|cancel|discard|save for later/i);
      if (!next) return needYou([], "I couldn't find the next button");
      const sig = (root.innerText || "").slice(0, 600);
      next.click();
      await waitFor(() => (getRoot()?.innerText || "").slice(0, 600) !== sig, 6000);
      await sleep(400);
      const r2 = getRoot();
      const err = r2?.querySelector('.artdeco-inline-feedback--error, [role=alert]:not(:empty), [aria-invalid=true]');
      const nowSig = (r2?.innerText || "").slice(0, 600);
      if (err && nowSig === sig) return needYou([], "The site says something is missing");
      if (nowSig === lastSig && nowSig === sig) return needYou([], "I'm stuck on this step");
      lastSig = sig;
      if (filled === 0 && step > 12) break;
    }
    if (!stopFlag) needYou([], "This form has more steps than expected");
  }

  async function linkedIn(autoSubmit) {
    const dialog = () => document.querySelector(".jobs-easy-apply-modal, [data-test-modal-id='easy-apply-modal'], .artdeco-modal[role=dialog]");
    if (!dialog()) {
      const btn = findBtn(document, /easy apply/i);
      if (!btn) {
        if (findBtn(document, /^apply/i)) return qpanel("This job applies on the company's own site. Click Apply there, then use “Fill this page”.");
        if (pageHas(/applied .* ago|application submitted/i)) return qpanel("You've already applied to this job.");
        return qpanel("Open a LinkedIn job with an Easy Apply button first.");
      }
      btn.click();
      if (!(await waitFor(dialog))) return qpanel("Easy Apply didn't open. Try again.");
      await human();
    }
    return stepLoop(dialog, /^(next|continue|review|continue to next step|review your application)$/i, /submit application/i, autoSubmit);
  }

  async function naukri(autoSubmit) {
    const drawer = () => document.querySelector('[class*="chatbot_Drawer"], [class*="chatbot_drawer"], [class*="chatbot"]');
    if (!drawer()) {
      if (pageHas(/^\s*applied\s*$/im) || findBtn(document, /^applied$/i)) return qpanel("You've already applied to this job.");
      const btn = findBtn(document, /^(apply|easy apply|1-click apply)$/i) || document.querySelector("#apply-button");
      if (!btn) {
        if (findBtn(document, /apply on company site/i)) return qpanel("This job applies on the company's own site. Open it there and use “Fill this page”.");
        return qpanel("Open a Naukri job page with an Apply button first.");
      }
      if (!autoSubmit) {
        mark(btn, "#4f7cff"); btn.scrollIntoView({ block: "center" });
        const p = qpanel("On Naukri, the Apply button sends your Naukri profile right away.", bigBtn("sub", "Apply now", "#2ecc71"));
        p.querySelector('[data-qp="sub"]').onclick = () => { chrome.storage.local.set({ apNaukriOk: Date.now() }); btn.click(); naukriAfter(); };
        return;
      }
      await human(); btn.click();
    }
    return naukriAfter();
  }

  async function naukriAfter() {
    const drawer = () => document.querySelector('[class*="chatbot_Drawer"], [class*="chatbot_drawer"], [class*="chatbot"]');
    const state = await waitFor(() => (pageHas(/successfully applied|applied successfully|you have applied/i) ? "ok" : drawer() ? "bot" : null), 10000);
    if (state === "ok") return finishedOk();
    if (state !== "bot") return qpanel("Clicked Apply. I couldn't see a confirmation, so check the page.", bigBtn("ok", "Mark as applied", "#2ecc71"));
    // Recruiter questions, one at a time
    for (let q = 1; q <= 12 && !stopFlag; q++) {
      const d = drawer(); if (!d) break;
      if (pageHas(/successfully applied|applied successfully/i)) return finishedOk();
      qpanel(`Answering recruiter question ${q}…`);
      const { asks } = await fillStep(d);
      if (asks.length) return needYou(asks, "Naukri asked something only you can answer");
      await human();
      const save = findBtn(d, /^(save|submit|send|next)$/i) || d.querySelector('[class*="sendMsg"]');
      if (!save) return needYou([], "I couldn't find the Save button in Naukri's chat");
      const before = (d.innerText || "").length; save.click();
      await waitFor(() => !drawer() || (drawer().innerText || "").length !== before || pageHas(/successfully applied/i), 8000);
      await sleep(600);
    }
    if (pageHas(/successfully applied|applied successfully|you have applied/i)) return finishedOk();
    if (!drawer()) return qpanel("Done answering. Check the page for Naukri's confirmation.", bigBtn("ok", "Mark as applied", "#2ecc71"));
  }

  async function generic(autoSubmit) {
    // Indeed Apply and simple one-page / multi-step ATS forms (Greenhouse, Lever, Ashby…)
    if (site === "indeed" && !document.querySelector("input, textarea, select")) {
      const btn = findBtn(document, /apply now|easily apply|^apply$/i, /company site/i);
      if (!btn) return qpanel("Open an Indeed job with an Apply now button first.");
      btn.click(); return qpanel("Indeed opened the application. Press One-click Apply again on that page.");
    }
    const form = () => [...document.querySelectorAll("form")].filter(visible).sort((a, b) => b.querySelectorAll("input,textarea,select").length - a.querySelectorAll("input,textarea,select").length)[0] || document.body;
    return stepLoop(form, /^(next|continue|review|save and continue|review your application)$/i, /submit( your)? application|^submit$|send application|^apply$/i, autoSubmit);
  }

  async function quickApply() {
    if (running) return; running = true; stopFlag = false;
    try {
      const { autoSubmit = false, apCount = {}, apDailyCap = 25 } = await chrome.storage.local.get(["autoSubmit", "apCount", "apDailyCap"]);
      const today = apCount[new Date().toISOString().slice(0, 10)] || 0;
      if (autoSubmit && today >= apDailyCap) return qpanel(`You've hit today's limit of ${apDailyCap} auto-submitted applications. It protects your accounts from being flagged. Try again tomorrow.`);
      if (site === "linkedin") await linkedIn(autoSubmit);
      else if (site === "naukri") await naukri(autoSubmit);
      else await generic(autoSubmit);
    } catch (e) { qpanel(`⚠️ ${String(e.message || e)}`); }
    finally { running = false; }
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== "AP_QUICK") return;
    if (window !== window.top) return;
    reply({ message: "One-click Apply started. Watch the panel on the page." });
    quickApply();
  });
})();

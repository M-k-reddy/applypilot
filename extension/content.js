// ApplyPilot content script: read form -> ask API -> fill -> highlight. Never submits.
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

  function collect() {
    const fields = [], seenRadio = new Set(); let i = 0;
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const type = (el.type || el.tagName).toLowerCase();
      if (["hidden", "submit", "button", "search", "password", "image", "reset"].includes(type) || el.disabled) return;
      if (type !== "file" && !visible(el)) return;
      if (type === "radio") {
        if (!el.name || seenRadio.has(el.name)) return; seenRadio.add(el.name);
        const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
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
    return fields;
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
})();

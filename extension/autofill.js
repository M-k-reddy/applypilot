// ApplyPilot autofill helpers. Injected on demand into the active tab (all permitted frames) by the side panel.
// Exposes window.__AP = { collect, apply, readAnswers, clearMarks, inspect, audit, act }.
// Review mode (side panel) only reads and fills; it never clicks Submit.
// Auto mode (opt-in, driven by background.js) also uses inspect/audit/act: act() clicks Next/Continue, and clicks
// Submit only when background.js has already verified every gate (required fields filled, no ask_user, no CAPTCHA/login).
// Colours: green = filled, orange = needs you, blue = the button you click yourself.
(() => {
  if (window.__AP) return;

  const PREFIX = "f" + Math.random().toString(36).slice(2, 7) + "_"; // unique per frame, so ids never collide
  const GREEN = "#2ecc71", ORANGE = "#ff9f1c", BLUE = "#4f7cff";
  const SKIP = ["hidden", "submit", "button", "search", "password", "image", "reset"];

  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
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
      if (SKIP.includes(type) || el.disabled || el.readOnly && type !== "file") return;
      if (el.getAttribute("autocomplete") === "new-password" || el.getAttribute("autocomplete") === "current-password") return;
      if (type !== "file" && !visible(el)) return;
      if (type === "radio") {
        if (!el.name || seenRadio.has(el.name)) return; seenRadio.add(el.name);
        const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        const id = `${PREFIX}${i++}`; group.forEach((g) => (g.dataset.apId = id));
        const q = el.closest("fieldset")?.querySelector("legend")?.innerText || labelFor(el.closest("fieldset") || el.parentElement?.parentElement || el);
        fields.push({ id, label: clean(q), type: "radio", options: group.map(labelFor), required: el.required });
        return;
      }
      const id = `${PREFIX}${i++}`; el.dataset.apId = id;
      const f = { id, label: labelFor(el), type, required: el.required || el.getAttribute("aria-required") === "true" };
      if (el.tagName === "SELECT") f.options = [...el.options].map((o) => clean(o.text)).filter(Boolean).slice(0, 60);
      if (el.value && type !== "file" && type !== "checkbox") f.current = clean(el.value);
      fields.push(f);
    });
    return { fields, url: location.href, title: document.title, top: window === window.top };
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
    if (!resumeB64 || typeof resumeB64 !== "string") return false;
    const b64 = resumeB64.split(",")[1] || "";
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const dt = new DataTransfer(); dt.items.add(new File([bytes], resumeName || "resume.pdf", { type: "application/pdf" }));
    el.files = dt.files; el.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }

  const mark = (el, color, tip) => { if (!el) return; el.style.outline = `3px solid ${color}`; el.style.outlineOffset = "2px"; if (tip) el.title = tip; };

  async function apply(actions) {
    let filled = 0; const asks = [];
    for (const a of actions || []) {
      if (!a || typeof a.id !== "string" || !a.id.startsWith(PREFIX)) continue; // belongs to another frame
      const els = [...document.querySelectorAll(`[data-ap-id="${CSS.escape(a.id)}"]`)]; const el = els[0]; if (!el) continue;
      try {
        if (a.action === "ask_user") { asks.push({ id: a.id, reason: a.reason || "Needs you" }); mark(el.type === "radio" ? el.parentElement : el, ORANGE, `ApplyPilot: please answer (${a.reason || "needs you"})`); continue; }
        if (a.action === "upload_resume") {
          if (el.type === "file" && await uploadResume(el)) { filled++; mark(el.parentElement || el, GREEN); }
          else { asks.push({ id: a.id, reason: "Attach your resume (save it in the side panel Settings to auto-attach)" }); mark(el.parentElement || el, ORANGE); }
          continue;
        }
        if (el.type === "file") { asks.push({ id: a.id, reason: "Attach this file yourself" }); mark(el.parentElement || el, ORANGE); continue; }
        const val = String(a.value ?? "");
        if (el.type === "radio") {
          const pick = els.find((r) => labelFor(r).toLowerCase() === val.toLowerCase()) || els.find((r) => labelFor(r).toLowerCase().includes(val.toLowerCase()));
          if (pick && val) { pick.click(); filled++; mark(pick.parentElement, GREEN); } else { asks.push({ id: a.id, reason: a.reason || "Choose an option" }); mark(el.parentElement, ORANGE); }
          continue;
        }
        if (el.type === "checkbox") { const want = val === "true"; if (el.checked !== want) el.click(); filled++; mark(el, GREEN); continue; }
        if (el.tagName === "SELECT") {
          const opt = [...el.options].find((o) => clean(o.text).toLowerCase() === val.toLowerCase()) || [...el.options].find((o) => val && clean(o.text).toLowerCase().includes(val.toLowerCase()));
          if (opt) { setNative(el, opt.value); filled++; mark(el, GREEN); } else { asks.push({ id: a.id, reason: a.reason || "Pick an option" }); mark(el, ORANGE); }
          continue;
        }
        if (val !== "") { setNative(el, val); filled++; mark(el, GREEN); }
      } catch (_) { asks.push({ id: a.id, reason: "Could not fill this field" }); mark(el, ORANGE); }
    }
    const submit = highlightSubmit();
    return { filled, asks, submitFound: submit };
  }

  function highlightSubmit() {
    if (window !== window.top && !document.querySelector("input, textarea, select")) return false;
    const btn = [...document.querySelectorAll("button, input[type=submit], [role=button]")].filter(visible)
      .find((b) => /submit|apply|send application|review|next|continue|save and continue/i.test(b.innerText || b.value || b.getAttribute("aria-label") || ""));
    if (btn) { mark(btn, BLUE, "ApplyPilot: review the form, then click this yourself"); btn.scrollIntoView({ block: "center", behavior: "smooth" }); return true; }
    return false;
  }

  /** Read what the user typed into the fields we flagged, for "Save my answers". Never reads password/file fields. */
  function readAnswers(ids) {
    const out = [];
    for (const id of ids || []) {
      if (typeof id !== "string" || !id.startsWith(PREFIX)) continue;
      const els = [...document.querySelectorAll(`[data-ap-id="${CSS.escape(id)}"]`)]; const el = els[0]; if (!el) continue;
      if (el.type === "password" || el.type === "file" || el.type === "hidden") continue;
      let value = "", label = "";
      if (el.type === "radio") {
        const picked = els.find((r) => r.checked); value = picked ? labelFor(picked) : "";
        label = clean(el.closest("fieldset")?.querySelector("legend")?.innerText || labelFor(el.closest("fieldset") || el.parentElement?.parentElement || el));
      } else if (el.type === "checkbox") { value = el.checked ? "Yes" : "No"; label = labelFor(el); }
      else if (el.tagName === "SELECT") { value = clean(el.options[el.selectedIndex]?.text || ""); label = labelFor(el); if (/^(select|choose|--)/i.test(value)) value = ""; }
      else { value = String(el.value || "").trim().slice(0, 2000); label = labelFor(el); }
      if (label && value) out.push({ q: label, a: value });
    }
    return out;
  }

  function clearMarks() {
    document.querySelectorAll("[data-ap-id]").forEach((el) => { el.style.outline = ""; el.style.outlineOffset = ""; if (el.parentElement) el.parentElement.style.outline = ""; });
  }

  // ───────── Auto mode helpers (read-only except act())
  const SUCCESS = /(thank(s| you) for (applying|your application|your interest)|application (has been |was |is )?(successfully )?(submitted|received|sent|complete)|successfully (applied|submitted)|we('|’)ve received your application|we have received your application|your application (has been|was|is) (submitted|received|sent)|applied successfully|you have (successfully )?applied|you('|’)ve applied)/i;
  const LOGIN_TEXT = /\b(sign|log) ?in (to|before you) (apply|continue)|please (sign|log) ?in\b|create an account to apply|login to apply/i;
  const NEXT_RE = /^(next|continue|save (and|&) continue|save (and|&) next|proceed|next step|review|review application|continue to (next step|review))\b/i;
  const SUBMIT_RE = /^(submit|submit application|submit your application|send application|finish|complete application|confirm and submit)\b/i;
  const WEAK_SUBMIT_RE = /^(apply|apply now|submit and apply)\b/i; // only counts as final when it sits inside a form with fields
  const ENTRY_RE = /^(apply|apply now|apply for this (job|position|role)|apply to this job|start application|i('|’)m interested)\b/i;
  const SSO_RE = /\b(with|using|via) (google|linkedin|facebook|apple|microsoft|github|indeed|email|otp)\b|sign ?in|log ?in|sign ?up|register|create account/i;
  const btnText = (b) => clean(b.innerText || b.value || b.getAttribute("aria-label") || "").slice(0, 80);
  // v2.10: anti-flag stops (OTP prompt, "unusual activity" / rate-limit text).
  const OTP_TEXT = /enter (the |your )?(otp|one[- ]time (password|passcode|code))|otp (has been |was )?sent|enter (the |your )?(\d-digit )?verification code|verification code (has been |was )?sent to/i;
  const UNUSUAL_TEXT = /unusual (activity|traffic)|suspicious activity|automated (queries|requests)|too many (applications|requests|attempts)|are you a robot|verify (that )?you are (a )?human|temporarily blocked|request (has been )?blocked/i;
  const pageText = () => (document.body ? document.body.innerText || "" : "").slice(0, 60000);

  function captchaVisible() {
    for (const f of document.querySelectorAll("iframe")) {
      const src = f.getAttribute("src") || "";
      if (!/recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|geetest/i.test(src)) continue;
      if (/size=invisible/i.test(src)) continue; // invisible reCAPTCHA badge alone is not a challenge
      if (visible(f) && f.getBoundingClientRect().height > 30) return true;
    }
    return [...document.querySelectorAll(".g-recaptcha:not([data-size=invisible]), .h-captcha, .cf-turnstile, #captcha, [id*=captcha i] img, input[name*=captcha i]")].some(visible);
  }
  function loginWall() {
    const pw = [...document.querySelectorAll("input[type=password]")].some(visible);
    const path = /(^|\/)(login|signin|sign-in|sign_in|auth|sso|register|create-account)(\/|$|\?)/i.test(location.pathname);
    const host = /^(login|accounts?|auth|sso|signin)\./i.test(location.hostname);
    return pw || path || host || LOGIN_TEXT.test(pageText().slice(0, 8000));
  }
  /** Snapshot for Auto mode: is there a CAPTCHA / login wall / success message, and how many fields? */
  function inspect() {
    const t15 = pageText().slice(0, 15000);
    return { top: window === window.top, url: location.href, captcha: captchaVisible(), login: loginWall(), success: SUCCESS.test(pageText()),
      otp: OTP_TEXT.test(t15) || [...document.querySelectorAll("input[autocomplete='one-time-code']")].some(visible), unusual: UNUSUAL_TEXT.test(t15),
      fields: [...document.querySelectorAll("input, textarea, select")].filter((e) => !SKIP.includes((e.type || "").toLowerCase()) && (e.type === "file" || visible(e))).length,
      textLen: pageText().length, visibility: document.visibilityState };
  }
  const isRequired = (el) => el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(labelFor(el)) ||
    !!el.closest("[class*=required i], [data-required=true]") && /\*/.test(labelFor(el));
  /** Visible required fields that are still empty, plus fields the site marked invalid. Returns labels only. */
  function audit() {
    const missing = [], invalid = [], seen = new Set();
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const type = (el.type || el.tagName).toLowerCase();
      if (SKIP.includes(type) || el.disabled) return;
      if (type !== "file" && !visible(el)) return;
      if (el.getAttribute("aria-invalid") === "true") invalid.push(labelFor(el) || el.name || "field");
      if (!isRequired(el)) return;
      let empty;
      if (type === "radio") { if (!el.name || seen.has(el.name)) return; seen.add(el.name); empty = ![...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].some((r) => r.checked); }
      else if (type === "checkbox") empty = !el.checked;
      else if (type === "file") empty = !(el.files && el.files.length) && !/\.(pdf|docx?|rtf|txt)\b/i.test(el.parentElement?.parentElement?.innerText || "");
      else if (el.tagName === "SELECT") empty = !el.value || /^(select|choose|--|please select)/i.test(clean(el.options[el.selectedIndex]?.text || ""));
      else empty = !String(el.value || "").trim();
      if (empty) missing.push(labelFor(el) || el.name || "required field");
    });
    return { missing: missing.slice(0, 20), invalid: invalid.slice(0, 20) };
  }
  /** Find the step button. mode "find" just reports; "next" clicks Next/Continue; "submit" clicks the final Submit; "entry" clicks an Apply link/button. */
  function act(mode) {
    const btns = [...document.querySelectorAll("button, input[type=submit], [role=button], a[href]")].filter((b) => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true" && !SSO_RE.test(btnText(b)));
    const next = btns.find((b) => b.tagName !== "A" && NEXT_RE.test(btnText(b)));
    const inForm = (b) => { const f = b.closest("form"); return !!f && !!f.querySelector("input:not([type=hidden]), textarea, select"); };
    const submit = btns.find((b) => b.tagName !== "A" && SUBMIT_RE.test(btnText(b)) && (inForm(b) || document.querySelector("input:not([type=hidden]), textarea, select")))
      || btns.find((b) => b.tagName !== "A" && WEAK_SUBMIT_RE.test(btnText(b)) && inForm(b));
    const entry = btns.find((b) => ENTRY_RE.test(btnText(b)) && (b.tagName !== "A" || !/^javascript:/i.test(b.getAttribute("href") || "")));
    const kind = next ? "next" : submit ? "submit" : entry ? "entry" : null;
    const found = { kind, label: kind ? btnText(next || submit || entry) : "", entryIsLink: !!entry && entry.tagName === "A", href: entry && entry.tagName === "A" ? entry.href : "" };
    if (mode === "find") return found;
    const target = mode === "next" ? next : mode === "submit" ? submit : mode === "entry" ? entry : null;
    if (!target) return { ...found, clicked: false };
    target.scrollIntoView({ block: "center" });
    target.click();
    return { ...found, clicked: true, clickedKind: mode };
  }

  window.__AP = { collect, apply, readAnswers, clearMarks, inspect, audit, act };
})();

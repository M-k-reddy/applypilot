// ApplyPilot Board Auto-Apply: page-side helpers. Injected (after boards.js) into the board runner's own tab only.
// Exposes window.__APB. Everything here is defensive: a missing selector returns an empty result, never throws.
// Only fill(), clickApply(), clickTab(), clickNext(), chatSend() and step() change the page; the runner (boardrunner.js)
// decides when they may be called. step("submit") is only called after the runner's final gate passes.
(() => {
  if (window.__APB) return;
  const CFG = (globalThis.AP_BOARDS && globalThis.AP_BOARDS.BOARDS) || {};
  const APPLIED_EXACT = globalThis.AP_BOARDS ? globalThis.AP_BOARDS.APPLIED_EXACT : /^applied$/i;
  const PREFIX = "b" + Math.random().toString(36).slice(2, 7) + "_";

  const vis = (el) => { try { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; } catch { return false; } };
  const txt = (el, max = 400) => (el ? (el.innerText || el.textContent || "") : "").replace(/\s+/g, " ").trim().slice(0, max);
  const qa = (sels, root = document, needVis = true) => {
    for (const s of sels || []) { try { const r = [...root.querySelectorAll(s)].filter((e) => !needVis || vis(e)); if (r.length) return r; } catch { /* bad selector */ } }
    return [];
  };
  const q1 = (sels, root, needVis) => qa(sels, root, needVis)[0] || null;
  const disabled = (b) => b.disabled || b.getAttribute("aria-disabled") === "true" || /\bdisabled\b/i.test(b.className || "");
  const CLICKABLE = "button, a, [role=button], input[type=submit], input[type=button], [class*='btn'], [class*='Btn'], [class*='button']";
  const btnLabel = (b) => (txt(b, 120) || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
  const clickables = (root = document) => { try { return [...root.querySelectorAll(CLICKABLE)].filter(vis); } catch { return []; } };
  const byText = (re, root = document) => re ? clickables(root).find((b) => re.test(btnLabel(b)) && !disabled(b)) || null : null;
  const bodyText = (n = 30000) => (document.body ? document.body.innerText || "" : "").slice(0, n);
  const cfg = (id) => CFG[id] || null;
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return ""; } };

  function captcha() {
    for (const f of document.querySelectorAll("iframe")) {
      const src = f.getAttribute("src") || "";
      if (!/recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|geetest/i.test(src) || /size=invisible/i.test(src)) continue;
      if (vis(f) && f.getBoundingClientRect().height > 30) return true;
    }
    if ([...document.querySelectorAll(".g-recaptcha:not([data-size=invisible]), .h-captcha, .cf-turnstile, #captcha, [id*=captcha i] img, input[name*=captcha i]")].some(vis)) return true;
    return /verify you are human|i('|’)m not a robot|complete the security check/i.test(bodyText(4000));
  }

  /** Page state for the gates: CAPTCHA, login wall, rate-limit message, success message. */
  function state(id) {
    const c = cfg(id) || {};
    const t = bodyText();
    const pw = [...document.querySelectorAll("input[type=password]")].some(vis);
    const loginBtns = clickables().filter((b) => /^(log ?in|sign ?in|login \/ register|login\/register)$/i.test(btnLabel(b))).length;
    const loginUrl = c.loginUrl ? c.loginUrl.test(location.hostname + location.pathname) : false;
    return {
      url: location.href, host: location.hostname, title: document.title.slice(0, 200),
      captcha: captcha(),
      login: loginUrl || pw || loginBtns > 0 || /please (log ?in|sign ?in) to (continue|apply)|login to apply|sign in to apply/i.test(t.slice(0, 8000)),
      rateLimit: c.rate ? c.rate.test(t.slice(0, 15000)) : false,
      rateText: c.rate ? ((t.match(c.rate) || [])[0] || "") : "",
      success: c.apply && c.apply.success ? c.apply.success.test(t) : false,
      textLen: t.length
    };
  }

  // ───────── listings
  function cardUrl(c, card) {
    const L = c.listing;
    if (L.jkAttr) { const jkEl = card.matches(`[${L.jkAttr}]`) ? card : card.querySelector(`[${L.jkAttr}]`); const jk = jkEl && jkEl.getAttribute(L.jkAttr); if (jk && L.jobUrl) return L.jobUrl(jk); }
    if (L.urlAttr && card.getAttribute(L.urlAttr)) return abs(card.getAttribute(L.urlAttr));
    const a = q1(L.link, card, false) || [...card.querySelectorAll("a[href]")].find((x) => L.linkPattern && L.linkPattern.test(x.getAttribute("href") || ""));
    return a && a.getAttribute("href") ? abs(a.getAttribute("href")) : "";
  }
  const exactApplied = (root) => { try { return [...root.querySelectorAll("span, div, p, button, a, label, i, b, strong")].some((e) => e.childElementCount <= 1 && APPLIED_EXACT.test(txt(e, 60)) && vis(e)); } catch { return false; } };

  function listJobs(id) {
    const c = cfg(id); if (!c) return { jobs: [] };
    const L = c.listing;
    let cards = qa(L.card);
    if (!cards.length && L.linkPattern) {
      const seen = new Set();
      for (const a of document.querySelectorAll("a[href]")) {
        if (!L.linkPattern.test(a.getAttribute("href") || "") || !vis(a)) continue;
        let n = a; for (let i = 0; i < 5 && n.parentElement && txt(n.parentElement, 3000).length < 1500; i++) n = n.parentElement;
        if (!seen.has(n)) { seen.add(n); cards.push(n); }
      }
    }
    // Drop cards nested inside other cards.
    cards = cards.filter((x) => !cards.some((y) => y !== x && y.contains(x)));
    const jobs = [];
    for (const card of cards.slice(0, 120)) {
      const url = cardUrl(c, card); if (!url) continue;
      const title = txt(q1(L.title, card, false), 200);
      const company = txt(q1(L.company, card, false), 160);
      const eligible = !L.require || L.require.test(txt(card, 3000)) || !!q1(L.requireSel || [], card, false);
      jobs.push({ url, title, company, applied: exactApplied(card), eligible });
    }
    return { jobs, url: location.href };
  }
  function scrollMore() { const h = document.body ? document.body.scrollHeight : 0; window.scrollTo(0, h); return h; }
  function tabs(id) {
    const c = cfg(id); if (!c || !c.listing.tabs) return [];
    const re = c.listing.tabs; const out = [];
    for (const b of document.querySelectorAll("[role=tab], [class*='tab'], button, a, li, span, div")) {
      if (b.childElementCount > 3 || !vis(b)) continue;
      const l = btnLabel(b).replace(/\s*\(\d+\)$/, "");
      if (l && l.length < 40 && re.test(btnLabel(b)) && !out.includes(l)) out.push(l);
    }
    return out.slice(0, 6);
  }
  function clickTab(id, label) {
    const c = cfg(id); if (!c || !c.listing.tabs) return false;
    const b = [...document.querySelectorAll("[role=tab], [class*='tab'], button, a, li, span, div")]
      .find((x) => x.childElementCount <= 3 && vis(x) && btnLabel(x).replace(/\s*\(\d+\)$/, "") === label);
    if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true;
  }
  function nextPage(id) {
    const c = cfg(id); if (!c) return { found: false };
    const L = c.listing;
    if (L.lastPage) { const lp = document.querySelector(L.lastPage); if (lp && String(lp.value) === "1") return { found: false }; }
    const el = q1(L.next) || byText(L.nextText);
    if (!el || disabled(el)) return { found: false };
    const href = el.tagName === "A" && el.getAttribute("href") && !/^(#|javascript:)/i.test(el.getAttribute("href")) ? abs(el.getAttribute("href")) : "";
    return { found: true, href };
  }
  function clickNext(id) { const c = cfg(id); const el = c && (q1(c.listing.next) || byText(c.listing.nextText)); if (!el) return false; el.click(); return true; }

  // ───────── job page
  function applyButtons(c) {
    const J = c.job;
    const ext = q1(J.externalSel) || byText(J.externalText);
    let on = qa(J.applySel).find((b) => !disabled(b) && !(J.externalText && J.externalText.test(btnLabel(b))) && !APPLIED_EXACT.test(btnLabel(b)))
      || byText(J.applyText);
    if (on && J.externalText && J.externalText.test(btnLabel(on))) on = null;
    if (on && J.applyRequiresSel && J.applyRequiresSel.length && !q1(J.applyRequiresSel, document, false)) on = null; // e.g. Indeed: "Apply now" without Indeed Apply = external
    return { on, ext };
  }
  function jobInfo(id) {
    const c = cfg(id); if (!c) return null;
    const J = c.job;
    const title = txt(q1(J.title), 200), company = txt(q1(J.company), 160);
    const descEl = q1(J.description);
    const description = descEl ? (descEl.innerText || "").slice(0, 12000) : "";
    const appliedBtn = clickables().some((b) => APPLIED_EXACT.test(btnLabel(b)));
    const applied = !!q1(J.applied) || appliedBtn;
    const { on, ext } = applyButtons(c);
    let kind = "none", href = "", label = "";
    if (on) { kind = "onboard"; label = btnLabel(on); }
    else if (ext) {
      kind = "external"; label = btnLabel(ext);
      const a = ext.tagName === "A" ? ext : ext.closest("a");
      href = a && a.getAttribute("href") ? abs(a.getAttribute("href")) : (ext.getAttribute("data-href") || ext.getAttribute("href") || "");
    }
    return { title, company, description, applied, kind, href, label, url: location.href };
  }
  function clickApply(id) {
    const c = cfg(id); if (!c) return { clicked: false };
    const { on } = applyButtons(c); if (!on) return { clicked: false };
    const a = on.tagName === "A" ? on : on.closest("a");
    const href = a && a.getAttribute("href") && !/^(#|javascript:)/i.test(a.getAttribute("href")) ? abs(a.getAttribute("href")) : "";
    on.scrollIntoView({ block: "center" }); on.click();
    return { clicked: true, label: btnLabel(on), href };
  }

  // ───────── application form / chatbot
  function container(c) {
    const A = c.apply || {};
    const hit = qa(A.containers || []).find((el) => el.querySelector("input:not([type=hidden]), textarea, select, [contenteditable='true']") || (A.chat && q1(A.chat.drawer, el)));
    return hit || document;
  }
  function labelFor(el) {
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && clean(l.innerText)) return clean(l.innerText); } catch { /* ignore */ } }
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) { const t = clean(by.split(" ").map((i) => document.getElementById(i)?.innerText || "").join(" ")); if (t) return t; }
    const fs = el.closest("fieldset")?.querySelector("legend"); if (fs && clean(fs.innerText)) return clean(fs.innerText);
    const wrap = el.closest("label"); if (wrap && el.type !== "radio" && el.type !== "checkbox" && clean(wrap.innerText)) return clean(wrap.innerText);
    let n = el;
    for (let i = 0; i < 5 && n; i++) {
      n = n.parentElement; if (!n) break;
      const t = n.querySelector("label, legend, h3, h4, h5, .assessment_question, [class*='question'], [class*='Question'], [class*='label'], p, span");
      if (t && !t.contains(el) && clean(t.innerText)) return clean(t.innerText);
    }
    return clean(el.placeholder || el.name || el.id);
  }
  const optLabel = (el) => {
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return txt(l, 160); } catch { /* ignore */ } }
    const w = el.closest("label"); if (w) return txt(w, 160);
    return txt(el.parentElement, 160) || el.value || "";
  };
  const isReq = (el, label) => el.required || el.getAttribute("aria-required") === "true" || /\*\s*$|\*\s*\(|^\*/.test(label || "");
  const hasStoredFileName = (el) => /\.(pdf|docx?|rtf)\b/i.test(txt(el.parentElement && el.parentElement.parentElement, 600));

  function chatQuestion(c, root) {
    const C = c.apply.chat; if (!C) return null;
    const drawer = q1(C.drawer, root === document ? document : root) || q1(C.drawer);
    if (!drawer) return null;
    const msgs = qa(C.botMsg, drawer);
    const label = msgs.length ? txt(msgs[msgs.length - 1], 400) : "";
    const chips = qa(C.chips, drawer);
    const radios = [...drawer.querySelectorAll("input[type=radio], input[type=checkbox]")].filter((r) => vis(r) || vis(r.parentElement));
    const options = (chips.length ? chips.map((x) => txt(x, 120)) : radios.map(optLabel)).filter(Boolean);
    const input = q1(C.input, drawer);
    if (!label && !options.length && !input) return null;
    const multi = radios.some((r) => r.type === "checkbox");
    return { id: "chat", label, kind: options.length ? (multi ? "multi" : "chips") : "text", options: [...new Set(options)].slice(0, 30), required: true };
  }

  /** Visible questions in the current step. Each field gets a data-apb-id so fill() can find it again. */
  function questions(id) {
    const c = cfg(id); if (!c) return { mode: "none", questions: [] };
    const root = container(c);
    const chat = chatQuestion(c, root);
    if (chat) return { mode: "chat", questions: [chat] };
    const out = []; const seen = new Set(); let i = 0;
    const els = [...root.querySelectorAll("input, textarea, select, [contenteditable='true']")];
    for (const el of els) {
      const tag = el.tagName; const type = (el.getAttribute("type") || (tag === "INPUT" ? "text" : tag)).toLowerCase();
      if (["hidden", "submit", "button", "search", "image", "reset", "password"].includes(type)) continue;
      if (el.disabled) continue;
      if (type !== "file" && type !== "radio" && type !== "checkbox" && !vis(el)) continue;
      if ((type === "radio" || type === "checkbox") && !vis(el) && !vis(el.parentElement || el)) continue;
      if (el.closest("[contenteditable='true']") && el.closest("[contenteditable='true']") !== el) continue;
      if (/search|newsletter|captcha/i.test(el.name || "")) continue;
      if (type === "radio" || (type === "checkbox" && el.name && root.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`).length > 1)) {
        if (!el.name || seen.has(el.name)) continue; seen.add(el.name);
        const group = [...root.querySelectorAll(`input[type=${type}][name="${CSS.escape(el.name)}"]`)];
        const qid = PREFIX + i++; group.forEach((g) => (g.dataset.apbId = qid));
        const label = labelFor(el.closest("fieldset") || el.closest("[class*='question'], [class*='Question'], .form-group") || el.parentElement?.parentElement || el);
        out.push({ id: qid, label, kind: type === "radio" ? "radio" : "multi", options: group.map(optLabel).slice(0, 30), required: group.some((g) => isReq(g, label)) || type === "radio", current: group.filter((g) => g.checked).map(optLabel).join(", ") });
        continue;
      }
      const qid = PREFIX + i++; el.dataset.apbId = qid;
      const label = labelFor(el);
      const f = { id: qid, label, required: isReq(el, label) };
      if (type === "file") { f.kind = "file"; f.current = (el.files && el.files.length) || hasStoredFileName(el) ? "file" : ""; }
      else if (tag === "SELECT") { f.kind = "select"; f.options = [...el.options].map((o) => txt(o, 120)).filter(Boolean).slice(0, 80); const s = el.options[el.selectedIndex]; f.current = s && el.value && !/^(select|choose|--|please)/i.test(txt(s)) ? txt(s) : ""; }
      else if (type === "checkbox") { f.kind = "checkbox"; f.current = el.checked ? "true" : ""; }
      else if (el.isContentEditable && tag !== "INPUT" && tag !== "TEXTAREA") { f.kind = "textarea"; f.current = txt(el, 3000); }
      else { f.kind = tag === "TEXTAREA" ? "textarea" : type === "number" || el.inputMode === "numeric" ? "number" : type === "email" ? "email" : type === "tel" ? "tel" : type === "date" ? "date" : "text"; f.current = String(el.value || "").trim().slice(0, 300); }
      const max = el.getAttribute("maxlength"); if (max) f.maxLength = Number(max) || undefined;
      out.push(f);
    }
    return { mode: out.length ? "form" : "none", questions: out.slice(0, 60) };
  }

  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function setEditable(el, value) {
    el.focus();
    try { document.execCommand("selectAll", false); document.execCommand("insertText", false, value); } catch { /* fallback below */ }
    if (txt(el, 5000) !== value.replace(/\s+/g, " ").trim()) { el.textContent = value; el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value })); }
    el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const matchOpt = (labels, want) => { const w = norm(want); let k = labels.findIndex((l) => norm(l) === w); if (k < 0) k = labels.findIndex((l) => w && norm(l).startsWith(w)); if (k < 0) k = labels.findIndex((l) => w && norm(l).includes(w)); return k; };

  async function uploadResume(el) {
    try {
      const { resumeB64, resumeName } = await chrome.storage.local.get(["resumeB64", "resumeName"]);
      if (!resumeB64 || typeof resumeB64 !== "string") return false;
      const bin = atob(resumeB64.split(",")[1] || ""); const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], resumeName || "resume.pdf", { type: "application/pdf" }));
      el.files = dt.files; el.dispatchEvent(new Event("change", { bubbles: true })); return true;
    } catch { return false; }
  }

  /** answers: [{id, value}] (value: string, or array of option labels for multi). Returns ids it could not set. */
  async function fill(id, answers) {
    const c = cfg(id); const failed = [];
    for (const a of answers || []) {
      try {
        if (a.id === "chat") {
          const C = c.apply.chat; const drawer = q1(C.drawer);
          const chips = qa(C.chips, drawer || document);
          const radios = drawer ? [...drawer.querySelectorAll("input[type=radio], input[type=checkbox]")] : [];
          const wants = [].concat(a.value);
          if (chips.length || radios.length) {
            let okAll = true;
            for (const w of wants) {
              if (chips.length) { const k = matchOpt(chips.map((x) => txt(x, 120)), w); if (k < 0) { okAll = false; continue; } chips[k].click(); }
              else { const k = matchOpt(radios.map(optLabel), w); if (k < 0) { okAll = false; continue; } radios[k].click(); }
            }
            if (!okAll) failed.push(a.id);
          } else {
            const input = q1(C.input, drawer || document);
            if (!input) { failed.push(a.id); continue; }
            if (input.isContentEditable) setEditable(input, String(a.value)); else setNative(input, String(a.value));
          }
          continue;
        }
        const els = [...document.querySelectorAll(`[data-apb-id="${CSS.escape(a.id)}"]`)]; const el = els[0];
        if (!el) { failed.push(a.id); continue; }
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (type === "file") { if (!(await uploadResume(el))) failed.push(a.id); continue; }
        if (type === "radio" || (type === "checkbox" && els.length > 1)) {
          const labels = els.map(optLabel); let ok = true;
          for (const w of [].concat(a.value)) { const k = matchOpt(labels, w); if (k < 0) { ok = false; continue; } if (!els[k].checked) els[k].click(); }
          if (!ok) failed.push(a.id);
          continue;
        }
        if (type === "checkbox") { const want = String(a.value) === "true"; if (el.checked !== want) el.click(); continue; }
        if (el.tagName === "SELECT") {
          const labels = [...el.options].map((o) => txt(o, 120)); const k = matchOpt(labels, String(a.value));
          if (k < 0) failed.push(a.id); else setNative(el, el.options[k].value);
          continue;
        }
        if (el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") { setEditable(el, String(a.value)); continue; }
        setNative(el, String(a.value));
      } catch { failed.push(a.id); }
    }
    return { failed };
  }

  function chatSend(id) {
    const c = cfg(id); const C = c && c.apply.chat; if (!C) return false;
    const drawer = q1(C.drawer) || document;
    const b = qa(C.send, drawer).find((x) => !disabled(x)) || byText(C.sendText, drawer);
    if (!b) return false; b.click(); return true;
  }

  /** Required-but-empty fields and site error messages in the current step. */
  function audit(id) {
    const c = cfg(id); const { questions: qs } = questions(id);
    const missing = qs.filter((q) => q.required && !q.current && q.kind !== "file").map((q) => q.label || "required field");
    const root = container(c);
    const errors = qa((c.apply && c.apply.errorSel) || [], root).map((e) => txt(e, 160)).filter((t) => t && t.length > 3 && !/^\*$/.test(t)).slice(0, 5);
    const invalid = [...root.querySelectorAll("[aria-invalid='true']")].filter(vis).map(labelFor).slice(0, 5);
    return { missing: missing.slice(0, 10), errors: [...new Set([...errors, ...invalid])] };
  }

  /** mode "find" reports the step button; "next"/"submit" clicks it. Buttons that sign in or go off-board never count. */
  function step(id, mode = "find") {
    const c = cfg(id); if (!c) return { kind: null };
    const root = container(c);
    const scopes = root === document ? [document] : [root, document];
    let next = null, submit = null;
    for (const s of scopes) {
      next = next || byText(c.apply.nextText, s);
      submit = submit || byText(c.apply.submitText, s);
      if (next || submit) break;
    }
    const bad = (b) => b && (/sign ?in|log ?in|register|company (site|website)|linkedin/i.test(btnLabel(b)) || (b.tagName === "A" && /linkedin\.com/i.test(b.getAttribute("href") || "")));
    if (bad(next)) next = null; if (bad(submit)) submit = null;
    if (next && submit && next === submit) next = null;
    const kind = next ? "next" : submit ? "submit" : null;
    const out = { kind, label: kind ? btnLabel(next || submit) : "" };
    if (mode === "find" || !kind) return out;
    const target = mode === "next" ? next : mode === "submit" ? submit : null;
    if (!target) return { ...out, clicked: false };
    target.scrollIntoView({ block: "center" }); target.click();
    return { ...out, clicked: true };
  }

  window.__APB = { state, listJobs, scrollMore, tabs, clickTab, nextPage, clickNext, jobInfo, clickApply, questions, fill, chatSend, audit, step };
})();

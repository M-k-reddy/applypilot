// ApplyPilot in-page button (v2.5). A small, dismissible tab on the right edge, in a closed shadow root.
// Shown only on supported boards (registered by background.js; never LinkedIn) when the page looks like a job post
// or an application form. One click opens the side panel, which runs the page's primary action.
(() => {
  "use strict";
  if (window.top !== window || window.__AP_FAB || /(^|\.)linkedin\.com$/i.test(location.hostname)) return;
  window.__AP_FAB = true;
  const KEY = `fabHidden:${location.hostname}`;
  const looksRelevant = () => {
    if (document.querySelector('script[type="application/ld+json"]') && /JobPosting/.test([...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join(" "))) return true;
    if (document.querySelector("form input[type=file], form textarea, #application-form, #application_form, .application-form")) return true;
    return /\/(job|jobs|job-listings|viewjob|internship|detail|apply|application)\b/i.test(location.pathname);
  };
  let host = null;
  function mount() {
    if (host || !looksRelevant()) return;
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;right:0;top:40%;z-index:2147483646";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .w{display:flex;align-items:center;font:600 12px/1 system-ui,sans-serif;filter:drop-shadow(0 2px 6px rgba(0,0,0,.18))}
      .go{display:flex;align-items:center;gap:6px;height:32px;padding:0 10px 0 8px;border:0;border-radius:8px 0 0 8px;background:#4f46e5;color:#fff;cursor:pointer;font:inherit}
      .go:focus-visible,.x:focus-visible{outline:2px solid #fff;outline-offset:-4px}
      .x{position:absolute;top:-8px;left:-8px;width:16px;height:16px;border-radius:50%;border:0;background:#0f1222;color:#fff;font:700 10px/16px system-ui;cursor:pointer;display:none;padding:0}
      .w:hover .x,.w:focus-within .x{display:block}
      .lbl{max-width:0;overflow:hidden;white-space:nowrap;transition:max-width .15s}
      .w:hover .lbl,.go:focus-visible .lbl{max-width:120px}
    </style>
    <div class="w"><button class="x" title="Hide on this site" aria-label="Hide ApplyPilot button on this site">×</button>
    <button class="go" title="ApplyPilot" aria-label="Open ApplyPilot"><img width="16" height="16" alt="" src="${chrome.runtime.getURL("icons/icon16.png")}"><span class="lbl">ApplyPilot</span></button></div>`;
    root.querySelector(".go").addEventListener("click", () => { chrome.runtime.sendMessage({ type: "fab:action" }).catch(() => {}); });
    root.querySelector(".x").addEventListener("click", () => { chrome.storage.local.set({ [KEY]: true }); host.remove(); host = null; stop = true; });
    document.documentElement.append(host);
  }
  let stop = false;
  chrome.storage.local.get(KEY).then((d) => {
    if (d[KEY]) return;
    mount();
    // SPAs (Naukri, Indeed) change the page without reloading: re-check a few times.
    let n = 0; const t = setInterval(() => { if (stop || host || ++n > 20) return clearInterval(t); mount(); }, 1500);
  }).catch(() => {});
})();

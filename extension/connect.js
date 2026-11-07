// ApplyPilot pairing relay. Injected by background.js ONLY into the Sign in tab the side panel opened.
// The website's /dashboard/extension/connect page posts { source: "applypilot-web", type: "ap:connect", key } to
// its own window; this relays it to the service worker and posts the result back.
(() => {
  "use strict";
  if (window.__AP_CONNECT) return; window.__AP_CONNECT = true;
  const reply = (r) => window.postMessage({ source: "applypilot-ext", type: "ap:connected", ok: !!(r && r.ok), error: (r && r.error) || "" }, location.origin);
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== "applypilot-web") return;
    if (m.type === "ap:ping") { window.postMessage({ source: "applypilot-ext", type: "ap:ready" }, location.origin); return; }
    if (m.type !== "ap:connect" || typeof m.key !== "string") return;
    chrome.runtime.sendMessage({ type: "ap:connect", key: m.key }).then(reply, (err) => reply({ ok: false, error: String(err && err.message || err) }));
  });
  window.postMessage({ source: "applypilot-ext", type: "ap:ready" }, location.origin);
})();

// Calls the ApplyPilot API from the service worker (avoids page CORS limits).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "AP_API") return;
  chrome.storage.local.get(["api", "token"], async ({ api, token }) => {
    if (!api || !token) return reply({ error: "Open the extension and save your API URL and token." });
    try {
      const r = await fetch(api + msg.path, {
        method: msg.method || "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: msg.body ? JSON.stringify(msg.body) : undefined
      });
      const j = await r.json();
      reply(r.ok ? j : { error: j.error || `Error ${r.status}` });
    } catch (e) { reply({ error: String(e) }); }
  });
  return true; // async reply
});

// Calls the ApplyPilot API from the service worker (avoids page CORS limits).
// Token: "ap1.<refresh_token>" from Dashboard -> Generate extension token. The worker swaps it for a
// short-lived access token and refreshes it on its own, so the extension stays signed in.
let refreshing = null;

async function getAccess(api, force = false) {
  const s = await chrome.storage.local.get(["token", "access", "accessExp"]);
  const tok = (s.token || "").trim();
  if (!tok.startsWith("ap1.")) return tok; // old-style pasted access token
  if (!force && s.access && (s.accessExp || 0) * 1000 > Date.now() + 60000) return s.access;
  if (!refreshing) {
    refreshing = (async () => {
      const r = await fetch(api + "/api/extension/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: tok.slice(4) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Extension token expired. Generate a new one on the Dashboard.");
      await chrome.storage.local.set({ token: "ap1." + j.refresh_token, access: j.access_token, accessExp: j.expires_at });
      return j.access_token;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "AP_API") return;
  chrome.storage.local.get(["api", "token"], async ({ api, token }) => {
    if (!api || !token) return reply({ error: "Open the extension and save your API URL and token." });
    const call = async (access) => fetch(api + msg.path, {
      method: msg.method || "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
      body: msg.body ? JSON.stringify(msg.body) : undefined
    });
    try {
      let r = await call(await getAccess(api));
      if (r.status === 401 && String(token).startsWith("ap1.")) r = await call(await getAccess(api, true));
      const j = await r.json();
      reply(r.ok ? j : { error: r.status === 401 ? "Token expired. On the Dashboard, press Generate extension token and paste it in settings." : j.error || `Error ${r.status}` });
    } catch (e) { reply({ error: String(e.message || e) }); }
  });
  return true; // async reply
});

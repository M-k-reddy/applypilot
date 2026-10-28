const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const status = (t, kind = "") => { const el = $("status"); el.textContent = t; el.className = `status ${kind}`; };
const api = (path, body, method = "POST") => new Promise((res) => chrome.runtime.sendMessage({ type: "AP_API", path, body, method }, res));
let job = null;

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }

chrome.storage.local.get(["api", "token", "resumeName"], (s) => {
  $("api").value = s.api || ""; $("token").value = s.token || "";
  if (!s.api || !s.token) $("settings").classList.remove("hidden");
  if (s.resumeName) status(`Resume saved: ${s.resumeName}`);
});
$("gear").onclick = () => $("settings").classList.toggle("hidden");

$("save").onclick = async () => {
  const data = { api: $("api").value.replace(/\/$/, ""), token: $("token").value.trim() };
  const f = $("resume").files[0];
  if (f) {
    const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    Object.assign(data, { resumeB64: b64, resumeName: f.name });
  }
  chrome.storage.local.set(data, () => { status("Settings saved.", "ok"); $("settings").classList.add("hidden"); });
};

// Read the job on the current page (read-only DOM read; no navigation, no clicks)
async function readJob() {
  const tab = await activeTab();
  return new Promise((res) => chrome.tabs.sendMessage(tab.id, { type: "AP_READ_JOB" }, (j) => { if (chrome.runtime.lastError) return res(null); res(j); }));
}
(async () => {
  job = await readJob();
  if (!job) { $("jobTitle").textContent = "Reload the page to use ApplyPilot here."; $("jobCompany").textContent = ""; return; }
  $("jobTitle").textContent = job.title || "No job detected";
  $("jobCompany").textContent = [job.company, job.location].filter(Boolean).join(" · ");
  if (job.domain) $("domain").value = job.domain;
  $("team").innerHTML = (job.hiringTeam || []).map((p) => `<a class="chip accent" href="${esc(p.profileUrl)}" target="_blank" title="${esc(p.title)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21a8 8 0 1 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>${esc(p.name)}</a>`).join("");
})();

$("fill").onclick = async () => {
  const tab = await activeTab();
  status("Reading the form…");
  chrome.tabs.sendMessage(tab.id, { type: "AP_FILL" }, (res) => {
    if (chrome.runtime.lastError) return status("Reload the page and try again.", "err");
    status(res?.message || "Done.", "ok");
  });
};

$("saveJob").onclick = async () => {
  job = job || (await readJob());
  if (!job?.url) return status("No job found on this page.", "err");
  $("saveJob").disabled = true; status("Saving…");
  const r = await api("/api/applications", { action: "save", source: "extension", job });
  $("saveJob").disabled = false;
  status(r?.error ? r.error : r.duplicate ? `Already in your tracker (${r.status}).` : "Saved to your tracker ✓", r?.error ? "err" : "ok");
};

const copyBtn = (id) => `<button class="btn sm" data-copy="${id}">Copy</button>`;
document.addEventListener("click", (e) => {
  const id = e.target?.dataset?.copy; if (!id) return;
  navigator.clipboard.writeText($(id).textContent); e.target.textContent = "Copied ✓";
});

$("referral").onclick = async () => {
  job = job || (await readJob());
  if (!job?.description || job.description.length < 40) return status("Open the full job description first, then try again.", "err");
  $("referral").disabled = true; status("Writing your note…");
  const person = job.hiringTeam?.[0];
  const r = await api("/api/outreach", { job, recipient: person ? { name: person.name, title: person.title } : undefined });
  $("referral").disabled = false;
  if (r?.error) return status(r.error, "err");
  status(person ? `Drafted for ${person.name}. Review before sending.` : "Drafted. Review before sending.", "ok");
  $("out").innerHTML = `<div class="card">
    <div class="row"><b>Referral request</b>${copyBtn("o_ref")}</div><div id="o_ref" class="out-block">${esc(r.referral_note)}</div>
    <div class="row"><b>LinkedIn note</b>${copyBtn("o_li")}</div><div id="o_li" class="out-block">${esc(r.linkedin_note)}</div>
    <div class="row"><b>Email</b><a class="btn sm" href="${esc(r.mailto)}" target="_blank">Open in mail</a></div>
    <div class="out-block"><b>${esc(r.email_subject)}</b>\n\n${esc(r.email_body)}</div></div>`;
};

$("findHr").onclick = async () => {
  job = job || (await readJob());
  const domain = $("domain").value.trim();
  if (!domain && !job?.company) return status("Add the company domain.", "err");
  $("findHr").disabled = true; status("Checking the company's public pages…");
  const r = await api("/api/find-hr", { domain, company: job?.company, people: (job?.hiringTeam || []).map((p) => ({ name: p.name, title: p.title })) });
  $("findHr").disabled = false;
  if (r?.error) return status(r.error, "err");
  status(`${r.domain}: mail server ${r.mx.ok ? "found" : "not found"}.`, r.mx.ok ? "ok" : "err");
  const pub = r.published.map((e) => `<div class="row"><span>${esc(e.email)}</span><span class="chip ok">published</span></div>`).join("");
  const gu = r.guesses.slice(0, 8).map((g) => `<div class="row"><span>${esc(g.email)}</span><span class="chip warn">unverified</span></div>`).join("");
  $("out").innerHTML = `<div class="card">${pub || '<div class="muted sm">No published addresses on their site.</div>'}${gu ? `<div class="muted xs" style="margin-top:8px">Pattern guesses (may bounce)</div>${gu}` : ""}<div class="muted xs" style="margin-top:6px">${esc(r.note)}</div></div>`;
};

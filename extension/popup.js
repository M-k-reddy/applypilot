const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const status = (t, kind = "") => { const el = $("status"); el.textContent = t; el.className = `status ${kind}`; };
const api = (path, body, method = "POST") => new Promise((res) => chrome.runtime.sendMessage({ type: "AP_API", path, body, method }, res));
let job = null, loadedToken = "";

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }

const FORM = [["f_notice","Notice period"],["f_exp","Total years of work experience"],["f_cur","Current CTC (INR per year)"],["f_expctc","Expected CTC (INR per year)"],["f_city","Current city"],["f_reloc","Willing to relocate"],["f_mode","Work mode accepted"],["f_auth","Authorized to work in India"],["f_visa","Requires visa sponsorship"],["f_start","Earliest start date"],["f_degree","Highest degree"],["f_grad","Graduation year"],["f_cgpa","CGPA / percentage"],["f_phone","Phone"],["f_li","LinkedIn URL"],["f_gh","GitHub / portfolio URL"],["f_lang","Languages known"],["f_div","Gender / diversity / disability / veteran questions"],["f_unk","Years with any tool or skill not in the resume"],["f_shift","Comfortable with rotational / night shifts"]];
const composeAnswers = (form, extra) => FORM.map(([id, label]) => form[id] !== undefined && form[id] !== "" ? `${label}: ${form[id]}` : "").filter(Boolean).join("\n") + (extra ? `\n${extra}` : "");
chrome.storage.local.get(["api", "token", "resumeName", "answersExtra", "answersForm", "apMinScore", "apDailyCap"], (s) => {
  $("api").value = s.api || ""; $("token").value = s.token || ""; loadedToken = s.token || ""; $("answers").value = s.answersExtra ?? "";
  const f = s.answersForm || {}; FORM.forEach(([id]) => { if (f[id] !== undefined) $(id).value = f[id]; });
  if (s.apMinScore != null) $("apMin").value = s.apMinScore; if (s.apDailyCap != null) $("apCap").value = s.apDailyCap;
  if (!s.api || !s.token) $("settings").classList.remove("hidden");
  if (s.resumeName) status(`Resume saved: ${s.resumeName}`);
});
$("gear").onclick = () => $("settings").classList.toggle("hidden");

$("save").onclick = async () => {
  const answersForm = Object.fromEntries(FORM.map(([id]) => [id, $(id).value.trim()]));
  if (!answersForm.f_expctc) { $("f_expctc").focus(); return status("Add your Expected CTC so Autopilot never has to ask.", "err"); }
  const answersExtra = $("answers").value.trim();
  const data = { api: $("api").value.replace(/\/$/, ""), token: $("token").value.trim(), answers: composeAnswers(answersForm, answersExtra), answersForm, answersExtra };
  if (data.token === loadedToken) delete data.token; // unchanged: keep the auto-refreshed one
  else { data.access = ""; data.accessExp = 0; }    // new token: sign in fresh with it
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

const footText = (on) => { $("foot").textContent = on ? "Auto-submit is on: quick-apply jobs are sent once every answer is filled. Max 25 a day." : "Auto-submit is off: you review the last step and press Submit."; };
chrome.storage.local.get(["autoSubmit"], (s) => { $("autoSubmit").checked = !!s.autoSubmit; footText(!!s.autoSubmit); });
$("autoSubmit").onchange = (e) => { chrome.storage.local.set({ autoSubmit: e.target.checked }); footText(e.target.checked); };

$("quick").onclick = async () => {
  const tab = await activeTab();
  chrome.tabs.sendMessage(tab.id, { type: "AP_QUICK" }, (res) => {
    if (chrome.runtime.lastError) return status("Reload the page and try again.", "err");
    status(res?.message || "Started.", "ok");
    setTimeout(() => window.close(), 900);
  });
};

$("autopilot").onclick = async () => {
  const { answersForm } = await chrome.storage.local.get("answersForm");
  if (!answersForm?.f_expctc) { $("settings").classList.remove("hidden"); return status("Fill Application answers (Expected CTC at least) and Save first.", "err"); }
  const minScore = Math.max(0, Math.min(100, Number($("apMin").value) || 70));
  const cap = Math.max(1, Math.min(50, Number($("apCap").value) || 25));
  await chrome.storage.local.set({ apMinScore: minScore, apDailyCap: cap, autoSubmit: true });
  const tab = await activeTab();
  if (!/linkedin\.com\/jobs\/(search|collections)/.test(tab.url || "")) return status("Open LinkedIn Jobs search with the Easy Apply filter first.", "err");
  chrome.tabs.sendMessage(tab.id, { type: "AP_AUTOPILOT" }, (res) => {
    if (chrome.runtime.lastError) return status("Reload the LinkedIn page and try again.", "err");
    status(res?.message || "Started.", "ok"); setTimeout(() => window.close(), 900);
  });
};

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

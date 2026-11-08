import { requireUser, handle, preflight, readJSON, HttpError } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { promptProfile, profileText } from "@/lib/profile";
import { assertQuota, recordUsage } from "@/lib/quota";
import { requireProfile, loadProfile, str, httpUrl, capWords, inventedNumbers } from "@/lib/server";
import { normalizeAutoSettings, normalizeBoardStatus } from "@/lib/autosettings";
import { atsScore } from "@/lib/ats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = preflight;

// Board Auto-Apply (extension v2.3, boardrunner.js). API key or dashboard JWT.
const BOARDS = ["naukri", "internshala", "indeed", "foundit"];
const STATUSES = ["saved", "needs_review", "applied"];
const normKey = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Same key as boardrunner.js urlKey (host + path, Indeed ?jk= kept) so tracker dedupe matches the extension.
const urlKey = (u: string) => { try { const x = new URL(u); const jk = x.searchParams.get("jk"); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${jk ? `?jk=${jk}` : ""}`.toLowerCase(); } catch { return String(u || "").toLowerCase(); } };
const SENSITIVE = /(salary|ctc|compensation|pay\b|stipend|password|ssn|aadhaar|aadhar|pan\b|passport|bank|account number|ifsc|otp)/i;

// GET -> { urls, keys, profile, answer_bank, unanswered, settings, board_status }
//   urls: tracker page URLs; keys: "company|title" normalised keys (boardrunner skips jobs already tracked).
export const GET = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const [{ data: apps, error }, { data: prof }, profile] = await Promise.all([
    db.from("applications").select("company, title, page_url").eq("user_id", user.id).order("created_at", { ascending: false }).limit(3000),
    db.from("profiles").select("unanswered, auto_settings, board_status").eq("id", user.id).maybeSingle(),
    loadProfile(db, user.id)
  ]);
  if (error) throw new HttpError(500, error.message);
  const urls = new Set<string>(), keys = new Set<string>();
  for (const a of apps || []) {
    if (a.page_url) urls.add(a.page_url);
    if (a.company && a.title) keys.add(`${normKey(a.company)}|${normKey(a.title)}`);
  }
  return Response.json({ urls: [...urls], keys: [...keys], profile, answer_bank: profile?.answer_bank || [], unanswered: prof?.unanswered || [],
    settings: normalizeAutoSettings(prof?.auto_settings), board_status: normalizeBoardStatus(prof?.board_status) });
});

// POST { action: "precheck" }                                            -> 402 when this month's autofills are used up
// POST { action: "log", board, url, title?, company?, status, note? }    -> upsert the tracker card (status saved | needs_review | applied)
// POST { action: "unanswered", questions: string[] }                     -> remember questions the runner could not answer
// POST { action: "status", boards: [{ board, connected, checked_at }] }   -> merge into profiles.board_status (v2.4)
// POST { action: "recs", board, jobs: [{ url, title, company, text? }] } -> board's recommended listings into public.jobs (v2.7)
// POST { action: "answer", question, job: { title, company, description } } -> { answer } short essay (<=120 words, profile facts only)
export const POST = handle(async (req) => {
  const { user, db } = await requireUser(req);
  const b = await readJSON<any>(req);
  const action = String(b.action || "");

  if (action === "precheck") {
    await assertQuota(db, user.id, "autofill");
    return Response.json({ ok: true });
  }

  if (action === "log") {
    const board = BOARDS.includes(b.board) ? b.board : str(b.board, 40).toLowerCase() || "board";
    const url = httpUrl(b.url, "url");
    if (!url) throw new HttpError(400, "url is required");
    const status = String(b.status || "");
    if (!STATUSES.includes(status)) throw new HttpError(400, "status must be saved, needs_review or applied");
    const company = str(b.company, 160), title = str(b.title, 200);
    const page_key = `board:${urlKey(url)}`.slice(0, 500);
    const now = new Date().toISOString();
    const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    const line = `Board Auto-Apply (${stamp} IST): ${str(b.note, 400) || status}`;

    const { data: cur, error: e1 } = await db.from("applications").select("id, status, notes, company, title")
      .eq("user_id", user.id).eq("page_key", page_key).maybeSingle();
    if (e1) throw new HttpError(500, e1.message);
    // One autofill per job the runner actually worked on (first time it reaches applied / needs_review).
    const counts = status !== "saved" && (!cur || cur.status === "saved");
    if (counts) await assertQuota(db, user.id, "autofill");

    let id: string;
    if (cur) {
      // Never downgrade a card the user already moved past "applied" (interview/offer/rejected).
      const keep = ["interview", "offer", "rejected"].includes(cur.status) || (cur.status === "applied" && status !== "applied");
      const upd: Record<string, unknown> = { updated_at: now, board, source: "auto", notes: [cur.notes || "", line].filter(Boolean).join("\n").slice(-4000) };
      if (!keep) { upd.status = status; if (status === "applied") upd.applied_at = now; if (status !== "saved") upd.autofilled_at = now; }
      if (!cur.company && company) upd.company = company;
      if (!cur.title && title) upd.title = title;
      const { error } = await db.from("applications").update(upd).eq("id", cur.id).eq("user_id", user.id);
      if (error) throw new HttpError(500, error.message);
      id = cur.id;
    } else {
      const { data, error } = await db.from("applications").insert({
        user_id: user.id, page_key, page_url: url, company, title, status, source: "auto", board, notes: line, updated_at: now,
        applied_at: status === "applied" ? now : null, autofilled_at: status !== "saved" ? now : null
      }).select("id").single();
      if (error) throw new HttpError(500, error.message);
      id = data.id;
    }
    if (counts) await recordUsage(db, user.id, "autofill");
    return Response.json({ ok: true, id, status });
  }

  if (action === "unanswered") {
    const qs: string[] = (Array.isArray(b.questions) ? b.questions : []).slice(0, 10).map((q: unknown) => str(q, 300)).filter((q: string) => q && !SENSITIVE.test(q));
    if (!qs.length) return Response.json({ saved: 0 });
    const { data, error } = await db.from("profiles").select("unanswered, profile_json").eq("id", user.id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    const k = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const answered = new Set(((data?.profile_json as any)?.answer_bank || []).filter((x: any) => x?.a).map((x: any) => k(String(x.q || ""))));
    const map = new Map<string, { q: string; seen: string }>();
    for (const x of (Array.isArray(data?.unanswered) ? data!.unanswered : []) as any[]) if (x?.q) map.set(k(x.q), { q: String(x.q), seen: String(x.seen || "") });
    const now = new Date().toISOString();
    for (const q of qs) if (!answered.has(k(q))) map.set(k(q), { q, seen: now });
    const list = [...map.values()].filter((x) => !answered.has(k(x.q))).slice(-100);
    const { error: e2 } = await db.from("profiles").update({ unanswered: list }).eq("id", user.id);
    if (e2) throw new HttpError(500, e2.message);
    return Response.json({ saved: qs.length, total: list.length });
  }

  if (action === "status") {
    const list = (Array.isArray(b.boards) ? b.boards : []).filter((x: any) => x && BOARDS.includes(x.board)).slice(0, 10);
    if (!list.length) throw new HttpError(400, "boards must list { board, connected }");
    const { data, error } = await db.from("profiles").select("board_status").eq("id", user.id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    const cur: Record<string, unknown> = { ...normalizeBoardStatus(data?.board_status) };
    for (const x of list) {
      const t = Date.parse(String(x.checked_at || ""));
      cur[x.board] = { connected: typeof x.connected === "boolean" ? x.connected : null, checked_at: new Date(Number.isFinite(t) ? Math.min(t, Date.now()) : Date.now()).toISOString() };
    }
    const { error: e2 } = await db.from("profiles").update({ board_status: cur }).eq("id", user.id);
    if (e2) throw new HttpError(500, e2.message);
    return Response.json({ ok: true, board_status: cur });
  }

  if (action === "recs") {
    const board = String(b.board || "");
    if (!BOARDS.includes(board)) throw new HttpError(400, "Unknown board");
    const profile = await loadProfile(db, user.id);
    const resume = profile ? profileText(profile) : "";
    const pre = `rec:${board}:`, seen = new Set<string>(), rows: any[] = [];
    for (const j of (Array.isArray(b.jobs) ? b.jobs : []).slice(0, 50)) {
      let url = "", title = "";
      try { url = httpUrl(j?.url, "url"); title = str(j?.title, 200); } catch { continue; }
      if (!url || !title) continue;
      const external_id = `${pre}${urlKey(url)}`.slice(0, 300); if (seen.has(external_id)) continue; seen.add(external_id);
      const text = typeof j?.text === "string" ? str(j.text, 2000) : "";
      const salary = str(j?.salary, 80) || (text.match(/(₹\s?[\d,.]+(?:\s*-\s*[\d,.]+)?(?:\s*(?:\/|per)\s*(?:month|year|annum))?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*(?:LPA|Lacs?|Lakhs?)(?:\s*P\.?A\.?)?)/i)?.[0] || "");
      const exp = text.match(/\b\d+\s*-\s*\d+\s*Yrs?\b/i)?.[0] || "";
      rows.push({ user_id: user.id, external_id, source: board, title, company: str(j?.company, 160) || "Unknown company", apply_url: url,
        location: str(j?.location, 160), salary: [exp, salary].filter(Boolean).join(" · ").slice(0, 80), description: text,
        fit_score: resume && text ? atsScore(text, resume).score : null });
    }
    if (rows.length) {
      const { error } = await db.from("jobs").upsert(rows, { onConflict: "user_id,external_id" });
      if (error) throw new HttpError(500, error.message);
      // Drop this board's older recs that are not in the new set and not on a tracker card.
      const { data: old } = await db.from("jobs").select("id, external_id").eq("user_id", user.id).like("external_id", `${pre}%`).limit(1000);
      const stale = (old || []).filter((x: any) => !seen.has(x.external_id)).map((x: any) => x.id);
      if (stale.length) {
        const { data: linked } = await db.from("applications").select("job_id").eq("user_id", user.id).in("job_id", stale);
        const keep = new Set((linked || []).map((x: any) => x.job_id));
        const del = stale.filter((id: string) => !keep.has(id));
        if (del.length) await db.from("jobs").delete().eq("user_id", user.id).in("id", del);
      }
    }
    return Response.json({ saved: rows.length });
  }

  if (action === "answer") {
    const question = str(b.question, 500, "question");
    if (!question) throw new HttpError(400, "question is required");
    if (SENSITIVE.test(question)) return Response.json({ answer: "" }); // never let the AI guess salary / ID numbers
    const job = b.job && typeof b.job === "object" ? b.job : {};
    const jt = str(job.title, 200), jc = str(job.company, 160), jd = str(job.description, 5000);
    await assertQuota(db, user.id, "autofill");
    const profile = await requireProfile(db, user.id);
    const out = await askJSON<{ answer: string }>(
`Write the candidate's answer to a job application question. First person, plain and specific, at most 120 words.
Use ONLY facts in PROFILE. Never invent employers, numbers, dates, skills or achievements. If PROFILE has nothing relevant, return an empty answer.
Return {"answer": "..."}.

QUESTION: ${question}
JOB (data): ${JSON.stringify({ title: jt, company: jc, description: jd })}
PROFILE (data): ${JSON.stringify(promptProfile(profile))}`);
    let answer = capWords(str(out?.answer, 2000), 120);
    if (answer && inventedNumbers(answer, profileText(profile) + "\n" + question).length) answer = ""; // invented metric -> needs review
    return Response.json({ answer });
  }

  throw new HttpError(400, "Unknown action. Use precheck, log, unanswered, status, recs or answer.");
});

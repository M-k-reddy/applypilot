// Zero-click auto-apply settings (v2.4). Stored in profiles.auto_settings (jsonb); board login status in profiles.board_status.
export const AUTO_BOARDS = ["naukri", "internshala", "indeed", "foundit"] as const;
export type BoardId = (typeof AUTO_BOARDS)[number];
export type AutoSettings = {
  enabled: boolean;              // scheduled daily run on/off (Run now works either way)
  run_time: string;              // "HH:MM" IST
  boards: Record<BoardId, { on: boolean; cap: number }>;
  daily_cap: number;             // overall board applications per IST day
  min_match: number;             // 0..100, skip jobs whose ATS match is below this (0 = off)
  min_lpa: number;               // v2.8: skip jobs whose listed pay tops out below this (lakhs per year; 0 = off; "not disclosed" is kept)
  roles: string[];               // role/keyword filter on job titles (empty = all recommended jobs)
  locations: string[];           // location filter on listing text (empty = any location)
};
export type BoardStatus = Record<string, { connected: boolean | null; checked_at: string }>;

const DEF_BOARDS: AutoSettings["boards"] = { naukri: { on: true, cap: 25 }, internshala: { on: true, cap: 25 }, indeed: { on: true, cap: 15 }, foundit: { on: false, cap: 15 } };
/** Clean a short list of keywords: trimmed, lower-cased, deduped, max 10 × 60 chars. */
export function cleanList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== "string") continue;
    const t = x.replace(/[^\p{L}\p{N} .+#/&-]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };

export function normalizeAutoSettings(raw: any): AutoSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  const t = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.run_time || "")) ? String(r.run_time) : "09:00";
  const boards = {} as AutoSettings["boards"];
  for (const id of AUTO_BOARDS) {
    const b = r.boards && typeof r.boards === "object" && r.boards[id] && typeof r.boards[id] === "object" ? r.boards[id] : {};
    boards[id] = { on: typeof b.on === "boolean" ? b.on : DEF_BOARDS[id].on, cap: int(b.cap, 1, 100, DEF_BOARDS[id].cap) };
  }
  return { enabled: r.enabled === true, run_time: t, boards, daily_cap: int(r.daily_cap, 1, 200, 20), min_match: int(r.min_match, 0, 100, 0), min_lpa: Math.max(0, Math.min(100, Math.round((Number(r.min_lpa) || 0) * 10) / 10)), roles: cleanList(r.roles), locations: cleanList(r.locations) };
}

export function normalizeBoardStatus(raw: any): BoardStatus {
  const out: BoardStatus = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of AUTO_BOARDS) {
    const s = raw[id];
    if (s && typeof s === "object") out[id] = { connected: typeof s.connected === "boolean" ? s.connected : null, checked_at: String(s.checked_at || "") };
  }
  return out;
}

/** Midnight today in IST as an ISO timestamp. */
export function istMidnightISO(d = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

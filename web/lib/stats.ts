export type AppRow = { id: string; job_id?: string | null; company: string; title: string; page_url?: string | null; status: string; notes?: string | null; follow_up: string | null; position?: number; updated_at: string; applied_at: string | null; created_at: string; autofilled_at?: string | null; source?: string | null; board?: string | null };

export function weekStats(apps: AppRow[]) {
  const weekAgo = Date.now() - 7 * 86400_000;
  const applied = apps.filter((a) => a.status !== "saved" && a.status !== "needs_review");
  const thisWeek = applied.filter((a) => Date.parse(a.applied_at || a.updated_at) >= weekAgo).length;
  const responded = applied.filter((a) => ["interview", "offer", "rejected"].includes(a.status)).length;
  const positive = applied.filter((a) => ["interview", "offer"].includes(a.status)).length;
  return { thisWeek, total: applied.length, responseRate: applied.length ? Math.round((responded / applied.length) * 100) : 0, interviews: positive };
}


const BOARD_NAMES: Record<string, string> = { naukri: "Naukri", internshala: "Internshala", indeed: "Indeed", shine: "Shine", hirist: "Hirist", instahyre: "Instahyre", cutshort: "Cutshort", foundit: "Foundit", wellfound: "Wellfound", linkedin: "LinkedIn" };
/** Where the application went: the board name, else the link's site. */
export function siteOf(a: { board?: string | null; page_url?: string | null }): string {
  if (a.board) return BOARD_NAMES[a.board] || a.board;
  try { return a.page_url ? new URL(a.page_url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}

export const BOARD_TABS = ["naukri", "internshala", "indeed", "shine", "hirist", "instahyre", "cutshort", "foundit", "wellfound"];
export const boardLabel = (b: string) => BOARD_NAMES[b] || (b === "others" ? "Others" : b);
export const initials = (s: string) => (s || "?").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const istTime = (d: string | null) => d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
export const ago = (d: string | null) => { if (!d) return ""; const days = Math.floor((Date.now() - Date.parse(d)) / 86400_000); return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`; };

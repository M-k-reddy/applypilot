// Auto-apply assistant presets. OWNER: edit this list to change the chips on /dashboard/auto.
// Each preset is a patch of profiles.auto_settings (see lib/autosettings.ts). Only these keys are allowed:
//   enabled (bool), daily_cap (1..plan max), min_match (0..100), roles (string[]), locations (string[]),
//   boards (subset of "naukri" | "internshala" | "indeed" | "foundit"; LinkedIn is never allowed), run_time ("HH:MM" IST)
import { AUTO_BOARDS, type AutoSettings, type BoardId } from "./autosettings";

export type AutoPatch = Partial<Pick<AutoSettings, "enabled" | "daily_cap" | "min_match" | "roles" | "locations" | "run_time">> & { boards?: BoardId[] };
export type AutoPreset = { id: string; label: string; patch: AutoPatch };

export const AUTO_PRESETS: AutoPreset[] = [
  { id: "daily5", label: "Apply to 5 jobs daily", patch: { enabled: true, daily_cap: 5 } },
  { id: "daily10", label: "Apply to 10 jobs daily", patch: { enabled: true, daily_cap: 10 } },
  { id: "daily15", label: "Apply to 15 jobs daily", patch: { enabled: true, daily_cap: 15 } },
  { id: "daily20", label: "Apply to 20 jobs daily", patch: { enabled: true, daily_cap: 20 } },
  { id: "pause", label: "Pause auto-apply", patch: { enabled: false } },
  { id: "match70", label: "Only jobs with 70%+ match", patch: { min_match: 70 } }
];

export const BOARD_NAMES: Record<BoardId, string> = { naukri: "Naukri", internshala: "Internshala", indeed: "Indeed", foundit: "Foundit" };

/** Merge a patch into settings. `boards` turns the listed boards on and the rest off. */
export function applyPatch(s: AutoSettings, p: AutoPatch): AutoSettings {
  const out: AutoSettings = { ...s, boards: { ...s.boards } };
  if (typeof p.enabled === "boolean") out.enabled = p.enabled;
  if (typeof p.daily_cap === "number") out.daily_cap = p.daily_cap;
  if (typeof p.min_match === "number") out.min_match = p.min_match;
  if (Array.isArray(p.roles)) out.roles = p.roles;
  if (Array.isArray(p.locations)) out.locations = p.locations;
  if (typeof p.run_time === "string") out.run_time = p.run_time;
  if (Array.isArray(p.boards) && p.boards.length) for (const id of AUTO_BOARDS) out.boards[id] = { ...out.boards[id], on: p.boards.includes(id) };
  return out;
}

const list = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** Bot reply describing the plan now saved. */
export function describePlan(s: AutoSettings, clampedFrom?: number): string {
  if (!s.enabled) return "Done. Auto-apply is paused. Pick a daily plan below whenever you want it back on.";
  const boards = AUTO_BOARDS.filter((id) => s.boards[id].on).map((id) => BOARD_NAMES[id]);
  let t = `Done. I'll apply to ${s.daily_cap} job${s.daily_cap === 1 ? "" : "s"} every day at ${s.run_time} IST on ${boards.length ? list(boards) : "no boards (switch one on in Settings)"}`;
  if (s.roles.length) t += `, only ${list(s.roles)} roles`;
  if (s.locations.length) t += ` in ${list(s.locations)}`;
  t += s.min_match ? `, skipping jobs below ${s.min_match}% match.` : ".";
  if (clampedFrom && clampedFrom > s.daily_cap) t += ` (Your plan allows up to ${s.daily_cap} a day, so I capped it there.)`;
  return t + " Reminder: keep the extension on (Auto mode) and Chrome running at that time.";
}

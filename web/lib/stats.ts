export type AppRow = { id: string; job_id?: string | null; company: string; title: string; page_url?: string | null; status: string; notes?: string | null; follow_up: string | null; position?: number; updated_at: string; applied_at: string | null; created_at: string; autofilled_at?: string | null };

export function weekStats(apps: AppRow[]) {
  const weekAgo = Date.now() - 7 * 86400_000;
  const applied = apps.filter((a) => a.status !== "saved");
  const thisWeek = applied.filter((a) => Date.parse(a.applied_at || a.updated_at) >= weekAgo).length;
  const responded = applied.filter((a) => ["interview", "offer", "rejected"].includes(a.status)).length;
  const positive = applied.filter((a) => ["interview", "offer"].includes(a.status)).length;
  return { thisWeek, total: applied.length, responseRate: applied.length ? Math.round((responded / applied.length) * 100) : 0, interviews: positive };
}


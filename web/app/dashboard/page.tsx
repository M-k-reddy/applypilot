"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppContext";
import { PageHead, Meter, Empty } from "@/components/ui";
import { weekStats, type AppRow as App } from "@/lib/stats";


const USAGE_ROWS: [string, string][] = [["analysis", "Fit analyses & interview prep"], ["tailor", "Resume tailors"], ["cover_letter", "Cover letters"], ["autofill", "Autofills"]];

export default function Overview() {
  const { api, me } = useApp();
  const [apps, setApps] = useState<App[] | null>(null);
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    api<{ applications: App[] }>("/api/applications").then((j) => setApps(j.applications)).catch(() => setApps([]));
    api<{ keys: unknown[] }>("/api/keys").then((j) => setHasKey(j.keys.length > 0)).catch(() => {});
  }, [api]);

  const s = weekStats(apps || []);
  const today = new Date().toISOString().slice(0, 10);
  const due = (apps || []).filter((a) => a.follow_up && a.follow_up <= today && !["offer", "rejected"].includes(a.status));
  const steps = [
    { done: !!me?.hasProfile, label: "Upload your resume", href: "/dashboard/profile" },
    { done: (apps || []).length > 0, label: "Save your first job", href: "/dashboard/jobs" },
    { done: hasKey, label: "Connect the Chrome extension", href: "/dashboard/extension" }
  ];
  const pro = me?.plan === "pro";

  return (
    <>
      <PageHead title={`Hi${me?.name ? `, ${me.name.split(" ")[0]}` : ""} 👋`} sub="Here is where your job hunt stands.">
        <Link href="/dashboard/jobs" className="btn btn-primary">Find jobs</Link>
      </PageHead>

      {steps.some((x) => !x.done) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h3>Get set up</h3><span className="badge">{steps.filter((x) => x.done).length}/3 done</span></div>
          <div className="grid grid-3">
            {steps.map((x) => (
              <Link key={x.label} href={x.href} className="list-item" style={{ color: "inherit", textDecoration: "none" }}>
                <div className="row"><span className={`badge ${x.done ? "badge-ok" : ""}`}>{x.done ? "✓" : "•"}</span><b>{x.label}</b></div><span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{s.thisWeek}</b><span>Applications this week</span></div>
        <div className="stat"><b>{s.total}</b><span>Applied in total</span></div>
        <div className="stat"><b>{s.responseRate}%</b><span>Response rate</span></div>
        <div className="stat"><b>{s.interviews}</b><span>Interviews & offers</span></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>This month&apos;s usage</h3>{!pro && me?.billingEnabled && <Link href="/dashboard/billing" className="btn btn-sm">Upgrade</Link>}</div>
          <div className="stack" style={{ gap: 14 }}>
            {USAGE_ROWS.map(([k, label]) => <Meter key={k} label={label} used={me?.usage?.[k] ?? 0} limit={me?.limits?.[k] ?? 0} unlimited={pro} />)}
          </div>
          <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>Resets on the 1st of each month (IST). Job search, ATS scoring and the tracker are unlimited.</p>
        </div>
        <div className="card">
          <div className="card-head"><h3>Follow-ups due</h3><Link href="/dashboard/tracker" className="btn btn-sm">Open tracker</Link></div>
          {apps === null ? <div className="skeleton" style={{ height: 120 }} /> : due.length ? (
            <div>{due.slice(0, 5).map((a) => (
              <div key={a.id} className="list-item"><div><h3>{a.company || "Company"}</h3><div className="small muted">{a.title} · due {a.follow_up}</div></div><span className="badge badge-warn">{a.status}</span></div>
            ))}</div>
          ) : <Empty icon="✓" title="Nothing due" body="Add follow-up dates on tracker cards and they will show up here." />}
        </div>
      </div>
    </>
  );
}

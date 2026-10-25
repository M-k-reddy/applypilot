"use client";
import Link from "next/link";

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: { href?: string; label: string; onClick?: () => void } }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p className="muted" style={{ maxWidth: 440, margin: "0 auto 16px" }}>{body}</p>
      {action && (action.href ? <Link className="btn btn-primary" href={action.href}>{action.label}</Link> : <button className="btn btn-primary" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

export const scoreColor = (v: number) => (v >= 75 ? "var(--ok)" : v >= 50 ? "var(--brand)" : v >= 30 ? "var(--warn)" : "var(--bad)");

export function ScoreRing({ value, size, label }: { value: number; size?: "sm"; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className={`ring ${size || ""}`} style={{ ["--v" as string]: v, ["--c" as string]: scoreColor(v) } as React.CSSProperties}
      role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label || "Score"}>
      <b>{v}</b>
    </div>
  );
}

export function Meter({ label, used, limit, unlimited }: { label: string; used: number; limit: number; unlimited?: boolean }) {
  const pct = unlimited ? 8 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between small"><span style={{ fontWeight: 650 }}>{label}</span><span className="muted">{used}{unlimited ? " · unlimited" : ` / ${limit}`}</span></div>
      <div className="meter" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={unlimited ? undefined : limit}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) { return <><span className="spinner" aria-hidden="true" />{label && <span>{label}</span>}</>; }

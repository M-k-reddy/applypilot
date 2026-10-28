"use client";
import { ReactNode, useState } from "react";

/* Small hand-rolled UI kit (shadcn-style, no deps). Styles live in app/globals.css. */

type Tone = "ok" | "warn" | "bad" | "accent" | "none";
export const scoreTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? "none" : v >= 75 ? "ok" : v >= 50 ? "warn" : "bad");

const P: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  briefcase: "M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1m-11 0h16a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1zm-1 6h18",
  check: "M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5M9 13h6M9 17h6",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  board: "M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  search: "m21 21-4.3-4.3M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z",
  user: "M20 21a8 8 0 1 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 1 8 7 8-7",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  bookmark: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z",
  external: "M14 4h6v6m0-6L10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5",
  copy: "M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM4 16V4a1 1 0 0 1 1-1h11",
  logout: "M15 17l5-5-5-5m5 5H9m3 9H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7",
  key: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z",
  print: "M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z"
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] || P.sparkle} />
    </svg>
  );
}

export function Card({ title, sub, action, children, className = "", id }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || action) && (
        <div className="card-head">
          <div>{title && <h3>{title}</h3>}{sub && <p className="muted sm">{sub}</p>}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "", size = "", loading, icon, children, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "" | "primary" | "ghost"; size?: "" | "sm" | "lg"; loading?: boolean; icon?: string }) {
  return (
    <button {...rest} className={`btn ${variant} ${size} ${rest.className || ""}`} disabled={rest.disabled || loading}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Chip({ tone = "none", children, title }: { tone?: Tone | "outline"; children: ReactNode; title?: string }) {
  return <span className={`chip ${tone === "none" ? "" : tone}`} title={title}>{children}</span>;
}

/** Circular score (0-100). */
export function ScoreRing({ value, size = 64, stroke = 6, sub }: { value: number | null | undefined; size?: number; stroke?: number; sub?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  const tone = scoreTone(value);
  return (
    <div className={`ring tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={value === null || value === undefined ? "No score" : `Score ${value} out of 100`}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="bar" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} stroke="currentColor" />
      </svg>
      <div className="label"><div><div className="num" style={{ fontSize: size * 0.3 }}>{value ?? "–"}</div>{sub && <div className="sub">{sub}</div>}</div></div>
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: Tone }) {
  const t = tone || scoreTone(value);
  return <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className={t === "none" ? "accent" : t} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Skeleton({ h = 14, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />;
}

export function SkeletonJob() {
  return (
    <div className="job">
      <Skeleton h={56} w={56} r={28} />
      <div className="stack" style={{ gap: 8 }}><Skeleton h={16} w="55%" /><Skeleton h={12} w="35%" /><div className="row"><Skeleton h={20} w={70} r={99} /><Skeleton h={20} w={60} r={99} /><Skeleton h={20} w={80} r={99} /></div></div>
    </div>
  );
}

export function Empty({ icon = "sparkle", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon"><Icon name={icon} /></div>
      <h4>{title}</h4>
      {children && <p className="sm" style={{ maxWidth: 420 }}>{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = "bad", children }: { tone?: "bad" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alert ${tone}`} role={tone === "bad" ? "alert" : "status"}>{children}</div>;
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" icon={done ? "check" : "copy"} onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? "Copied" : label}
    </Button>
  );
}

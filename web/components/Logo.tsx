import Link from "next/link";

export function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 13.5 21 4l-6.5 17-3.2-7.3L3 13.5Z" fill="currentColor" /><path d="m11.3 13.7 3.4-3.4" stroke="#7c3aed" strokeWidth="1.6" strokeLinecap="round" /></svg>
    </span>
  );
}

export default function Logo({ href = "/" }: { href?: string }) {
  return <Link href={href} className="logo"><LogoMark /> ApplyPilot</Link>;
}

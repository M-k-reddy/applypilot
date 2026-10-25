import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap", weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "ApplyPilot — AI job copilot for Indian freshers", template: "%s · ApplyPilot" },
  description: "Tailor your resume to any job with visible, approvable edits and a live ATS score. Cover letters, safe autofill, interview prep and a Kanban tracker. Free for students.",
  applicationName: "ApplyPilot"
};
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f7fb" }, { media: "(prefers-color-scheme: dark)", color: "#0a0c14" }]
};

// Light by default; a saved choice wins. Runs before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("ap-theme");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={sans.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><a href="#main" className="skip-link">Skip to content</a>{children}</body>
    </html>
  );
}

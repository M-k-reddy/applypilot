"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApp, useBusy } from "@/components/AppContext";
import { PageHead, Spinner } from "@/components/ui";

// v2.5 extension Sign in. The side panel opens /dashboard/extension/connect?ext=<extension id>.
// "Connect" mints an API key with this signed-in session and hands it to the extension:
//  1) chrome.runtime.sendMessage(extId) when this site is in the extension's externally_connectable list;
//  2) window.postMessage, relayed by the extension's connect.js (injected into this tab only).
// The key is never shown or stored on this page.
type ChromeLike = { runtime?: { sendMessage?: (id: string, msg: unknown, cb: (r: any) => void) => void; lastError?: unknown } };
type State = "idle" | "done" | "error";

export default function ConnectExtension() {
  const { api, me } = useApp();
  const { busy, run } = useBusy();
  const [ext, setExt] = useState("");
  const [relay, setRelay] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [err, setErr] = useState("");
  const waiter = useRef<((ok: boolean, e?: string) => void) | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ext") || "";
    setExt(/^[a-p]{32}$/.test(id) ? id : "");
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "applypilot-ext") return;
      if (m.type === "ap:ready") setRelay(true);
      if (m.type === "ap:connected" && waiter.current) waiter.current(!!m.ok, m.error);
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "applypilot-web", type: "ap:ping" }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const sendExternal = (key: string) => new Promise<boolean>((resolve) => {
    const c = (globalThis as unknown as { chrome?: ChromeLike }).chrome;
    if (!ext || !c?.runtime?.sendMessage) return resolve(false);
    try { c.runtime.sendMessage(ext, { type: "ap:connect", key }, (r) => resolve(!c.runtime?.lastError && !!r?.ok)); }
    catch { resolve(false); }
  });
  const sendRelay = (key: string) => new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { waiter.current = null; resolve(false); }, 8000);
    waiter.current = (ok, e) => { clearTimeout(t); waiter.current = null; if (!ok && e) setErr(e); resolve(ok); };
    window.postMessage({ source: "applypilot-web", type: "ap:connect", key }, window.location.origin);
  });

  const connect = () => run("connect", async () => {
    setErr("");
    const r = await api<{ key: string }>("/api/keys", { method: "POST", json: { name: "Chrome extension (Sign in)" } });
    const ok = (await sendExternal(r.key)) || (await sendRelay(r.key));
    if (ok) setState("done");
    else { setState("error"); setErr((e) => e || "The extension did not answer. Open the ApplyPilot side panel and press Sign in again."); }
  });

  return (
    <>
      <PageHead title="Connect the Chrome extension" sub="Links the ApplyPilot side panel to this account. No keys to copy." />
      <div className="card" style={{ maxWidth: 520 }}>
        {state === "done" ? (
          <>
            <h3>Connected</h3>
            <p className="small">The extension is signed in as <b>{me?.email || "you"}</b>. You can close this tab and go back to the side panel.</p>
            <button className="btn btn-primary" onClick={() => window.close()}>Close this tab</button>
          </>
        ) : (
          <>
            <h3>Sign in the extension as {me?.email || "this account"}?</h3>
            <p className="small muted">This creates a key for the extension. You can revoke it any time on the Extension page.</p>
            {!ext && !relay && <div className="alert" style={{ marginBottom: 12 }}>Open this page from the extension: click <b>Sign in</b> in the ApplyPilot side panel.</div>}
            {err && <div className="alert alert-bad" style={{ marginBottom: 12 }}>{err}</div>}
            <button className="btn btn-primary" onClick={connect} disabled={!!busy || (!ext && !relay)}>{busy === "connect" ? <Spinner /> : "Connect extension"}</button>
            <p className="tiny muted" style={{ marginTop: 12 }}>Prefer a manual key? <Link href="/dashboard/extension">Manage keys</Link></p>
          </>
        )}
      </div>
    </>
  );
}

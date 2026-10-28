"use client";
import { useEffect, useState } from "react";
import { Page, useAuth } from "@/components/auth";
import { JobCard } from "@/components/JobCard";
import { Alert, Button, Card, Chip, Empty, Field, Icon, SkeletonJob } from "@/components/ui";

export default function FeedPage() {
  const auth = useAuth();
  const [q, setQ] = useState("software engineer, ML, data analyst, intern");
  const [loc, setLoc] = useState("India, Remote");
  const [remote, setRemote] = useState(false);
  const [fresher, setFresher] = useState(true);
  const [jobs, setJobs] = useState<any[] | null>(null); const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [alerts, setAlerts] = useState<any[]>([]); const [notes, setNotes] = useState<any[]>([]);
  const [emailAlerts, setEmailAlerts] = useState(true); const [alertMsg, setAlertMsg] = useState("");

  const search = async () => {
    setBusy(true); setErr("");
    try {
      const p = new URLSearchParams({ q, location: loc, remote: String(remote), fresher: String(fresher), limit: "80" });
      const j = await auth.api(`/api/feed?${p}`); setJobs(j.jobs || []); setTotal(j.total || 0);
    } catch (e: any) { setErr(e.message); setJobs([]); } finally { setBusy(false); }
  };
  const loadAlerts = () => {
    auth.api("/api/alerts").then((j) => setAlerts(j.alerts)).catch(() => {});
    auth.api("/api/notifications").then((j) => setNotes(j.notifications)).catch(() => {});
  };
  useEffect(() => { if (auth.session) { search(); loadAlerts(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [auth.session]);

  const addAlert = async () => {
    setAlertMsg("");
    try { await auth.api("/api/alerts", { method: "POST", json: { keywords: q, location: loc, remote, fresher, email: emailAlerts } }); setAlertMsg("Alert created. New matches arrive daily."); loadAlerts(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <Page title="Jobs" sub="Fresh roles from company job boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters), refreshed daily and ranked by your match." auth={auth}
      actions={<Button icon="bell" onClick={addAlert}>Save as alert</Button>}>
      <Card>
        <form className="toolbar" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <Field label="Keywords"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Comma separated, any can match" /></Field>
          <Field label="Location"><input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="e.g. Hyderabad, Remote" /></Field>
          <label className="check-label" style={{ paddingBottom: 10 }}><input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Remote only</label>
          <label className="check-label" style={{ paddingBottom: 10 }}><input type="checkbox" checked={fresher} onChange={(e) => setFresher(e.target.checked)} /> Fresher (0–2 yrs)</label>
          <Button variant="primary" icon="search" loading={busy} type="submit">Search</Button>
        </form>
        {alertMsg && <div style={{ marginTop: 12 }}><Alert tone="ok">{alertMsg}</Alert></div>}
        {err && <div style={{ marginTop: 12 }}><Alert>{err}</Alert></div>}
      </Card>

      <div className="stack">
        <div className="row between">
          <h3>{busy ? "Searching…" : `${total} matching job${total === 1 ? "" : "s"}`}</h3>
          {!busy && total > 0 && <span className="muted sm">Best match first</span>}
        </div>
        {(busy || jobs === null) && <><SkeletonJob /><SkeletonJob /><SkeletonJob /></>}
        {!busy && jobs?.length === 0 && <Empty icon="search" title="No jobs match yet">Try broader keywords (e.g. “engineer”), add “Remote”, or untick Fresher. The feed refreshes every day.</Empty>}
        {!busy && jobs?.map((j) => <JobCard key={j.id} j={j} api={auth.api} />)}
      </div>

      <Card id="alerts" title="Job alerts" sub="Saved searches. New matches land here every morning, and by email when the server has email set up."
        action={<label className="check-label"><input type="checkbox" checked={emailAlerts} onChange={(e) => setEmailAlerts(e.target.checked)} /> Email me too</label>}>
        {alerts.length === 0 ? <Empty icon="bell" title="No alerts yet" action={<Button size="sm" icon="plus" onClick={addAlert}>Create from current search</Button>}>Set your filters above, then save them as an alert.</Empty>
          : <div>{alerts.map((a) => (
            <div key={a.id} className="list-row">
              <Icon name="bell" />
              <div className="grow"><b className="sm">{a.keywords}</b>
                <div className="chips" style={{ marginTop: 4 }}>{a.location && <Chip>{a.location}</Chip>}{a.remote && <Chip>Remote</Chip>}{a.fresher && <Chip tone="accent">Fresher</Chip>}{a.email && <Chip tone="outline">Email</Chip>}</div></div>
              <Button size="sm" variant="ghost" icon="trash" aria-label="Delete alert" onClick={async () => { await auth.api(`/api/alerts?id=${a.id}`, { method: "DELETE" }); loadAlerts(); }} />
            </div>))}</div>}

        {notes.length > 0 && <>
          <hr className="divider" />
          <div className="row between"><h4>Notifications</h4><Button size="sm" variant="ghost" onClick={async () => { await auth.api("/api/notifications", { method: "POST", json: { all: true } }); loadAlerts(); }}>Mark all read</Button></div>
          <div className="stack" style={{ marginTop: 10 }}>
            {notes.map((n) => (
              <div key={n.id} className="card flat" style={{ padding: 14, opacity: n.read ? 0.65 : 1 }}>
                <div className="row between"><b className="sm">{!n.read && <Chip tone="accent">New</Chip>} {n.title}</b><span className="muted xs">{new Date(n.created_at).toLocaleString()}</span></div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="sm">
                  {(n.data?.jobs || []).slice(0, 8).map((j: any) => <li key={j.id}><a href={j.apply_url} target="_blank" rel="noreferrer">{j.title}</a> · {j.company}{j.score !== null && j.score !== undefined ? <span className="muted"> · {j.score}/100</span> : null}</li>)}
                </ul>
              </div>))}
          </div>
        </>}
      </Card>
    </Page>
  );
}

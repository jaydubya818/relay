import Link from "next/link";
import type { ReactNode } from "react";
import type { listActivity } from "@/lib/activity";
import { activityLabel, outcomeLabel } from "@/lib/owner-presentation";

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="owner-empty"><h2>{title}</h2><p>{children}</p></div>;
}

export function ActivityTimeline({ activity, filtered = false }: { activity: Awaited<ReturnType<typeof listActivity>>; filtered?: boolean }) {
  if (!activity.length) return <EmptyState title={filtered ? "No activity matches these filters" : "No activity yet"}>
    {filtered ? <>Try another filter or <Link className="text-link" href="/activity">clear filters</Link>.</> : "Agent actions and permission decisions will appear here after your Agents begin using Relay."}
  </EmptyState>;
  return <ol className="owner-timeline">{activity.map((item) => <li key={item.id}>
    <div className="owner-row"><div><strong>{item.agentName ?? "Relay"}</strong><p>{activityLabel(item.action)}</p></div>
      <span className={`owner-outcome ${item.status.toLowerCase()}`}>{outcomeLabel(item.status)}</span></div>
    <time className="subtle" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time>
    <details className="technical-details"><summary>View technical details</summary><dl className="owner-facts">
      <dt>Action</dt><dd>{item.action}</dd><dt>Capability</dt><dd>{item.capability}</dd>
      <dt>Outcome</dt><dd>{item.status}</dd><dt>Provider</dt><dd>{item.provider ?? "Relay"}</dd>
      <dt>Session</dt><dd>{item.sessionId}</dd><dt>Resource</dt><dd>{item.resourceId ?? "Not recorded"}</dd>
      <dt>Duration</dt><dd>{item.durationMs} ms</dd><dt>Audit reference</dt><dd>{item.id}</dd>
    </dl></details>
  </li>)}</ol>;
}

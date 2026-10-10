import Link from "next/link";
import { Status } from "@/components/page";
import type { ReactNode } from "react";
import type { listActivity } from "@/lib/activity";
import { activityLabel, outcomeLabel, permissionLabel, providerLabel } from "@/lib/owner-presentation";

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="owner-empty"><h2>{title}</h2><p>{children}</p></div>;
}

export function ActivityTimeline({ activity, filtered = false }: { activity: Awaited<ReturnType<typeof listActivity>>; filtered?: boolean }) {
  if (!activity.length) return <EmptyState title={filtered ? "No activity matches these filters" : "No activity yet"}>
    {filtered ? <>Try another filter or <Link className="text-link" href="/activity">clear filters</Link>.</> : <>Agent actions and permission decisions will appear here after a request through Relay. <Link className="text-link" href="/agents">Review your Agents and their permissions</Link> to get started.</>}
  </EmptyState>;
  return <ol className="owner-timeline">{activity.map((item) => <li key={item.id}>
    <details className="activity-record"><summary><span className={`timeline-dot ${item.status.toLowerCase()}`} /><span className="activity-summary"><strong>{activityLabel(item.action)}</strong><small>{item.agentName ?? "Relay"} · {providerLabel(item.provider ?? "RELAY")} · {item.durationMs} ms</small></span><span className="activity-end"><span className={`owner-outcome ${item.status.toLowerCase()}`}>{outcomeLabel(item.status)}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC</time><span className="detail-hint">View details ↗</span></span></summary>
    <div className="activity-detail"><dl className="owner-facts"><dt>Agent</dt><dd>{item.agentName ?? "Relay"}</dd><dt>Capability</dt><dd>{permissionLabel(item.capability)}</dd><dt>Authorization</dt><dd>{item.status === "DENIED" ? "Denied — this operation was not allowed." : item.status === "BLOCKED" ? "Blocked — execution did not proceed." : item.status === "SUCCESS" ? "Admitted for this recorded operation." : "Not separately recorded. Failure does not prove an authorization denial."}</dd><dt>Execution</dt><dd>{outcomeLabel(item.status)}</dd><dt>Resource</dt><dd>{item.resourceId ?? "Not recorded"}</dd></dl>
    {(item.status === "DENIED" || item.status === "FAILED" || item.status === "BLOCKED") && <p>Detailed cause is not included in this activity contract. Review the Agent’s grants, service configuration and execution policy before retrying.</p>}
    <details className="technical-details"><summary>View technical details</summary><dl className="owner-facts">
      <dt>Action</dt><dd>{item.action}</dd><dt>Capability</dt><dd>{item.capability}</dd>
      <dt>Outcome</dt><dd>{item.status}</dd><dt>Provider</dt><dd>{item.provider ?? "Relay"}</dd>
      <dt>Session</dt><dd>{item.sessionId}</dd><dt>Resource</dt><dd>{item.resourceId ?? "Not recorded"}</dd>
      <dt>Duration</dt><dd>{item.durationMs} ms</dd><dt>Audit reference</dt><dd>{item.id}</dd>
    </dl></details></div></details>
  </li>)}</ol>;
}

export function AgentIdentityStatus({ status }: { status: string }) {
  return <Status value={status === "ACTIVE" ? "ENABLED" : status} />;
}

export function GettingStarted() {
  return <section className="card getting-started" aria-labelledby="getting-started-title"><h2 id="getting-started-title">Set up your first Agent</h2><p className="subtle">Start with one identity and only the access it needs. Nothing runs automatically.</p><ol>
    <li><Link className="text-link" href="/agents/new">Create an Agent</Link><span>No permissions are granted by default. Store its credential securely in your Agent application.</span></li>
    <li><Link className="text-link" href="/connections">Connect a service if needed</Link><span>A service connection does not grant an Agent access.</span></li>
    <li><Link className="text-link" href="/agents">Choose permissions</Link><span>Open the Agent’s Capabilities tab, then make a permitted request from your Agent application.</span></li>
    <li><Link className="text-link" href="/activity">Review the first result</Link><span>Relay records the outcome here. Execution policies still apply.</span></li>
  </ol></section>;
}

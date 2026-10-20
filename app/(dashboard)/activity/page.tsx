export const metadata = { title: "Activity" };
import Link from "next/link";
import { PageHeader } from "@/components/page";
import { ActivityTimeline } from "@/components/owner-ui";
import { listActivity } from "@/lib/activity";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import type { ActivityStatus } from "@/lib/types";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const status = ["SUCCESS", "DENIED", "FAILED", "BLOCKED"].includes(params.status ?? "") ? params.status as ActivityStatus : undefined;
  const [activity, agents] = await Promise.all([
    listActivity(user.accountId, { agentId: params.agent, capability: params.capability, status, provider: params.provider }), listAgents(user.accountId),
  ]);
  const filtered = Boolean(params.agent || params.capability || status || params.provider);
  return <>
    <PageHeader eyebrow="Your Relay" title="Activity" description="Follow your Agents’ actions and permission decisions, with the original record available for every entry." />
    <form className="card owner-filters" aria-label="Filter activity">
      <div className="field"><label htmlFor="activity-agent">Agent</label><select id="activity-agent" name="agent" defaultValue={params.agent ?? ""}><option value="">All agents</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></div>
      <div className="field"><label htmlFor="activity-status">Outcome</label><select id="activity-status" name="status" defaultValue={status ?? ""}><option value="">All outcomes</option><option value="SUCCESS">Completed</option><option value="DENIED">Not allowed</option><option value="FAILED">Failed</option><option value="BLOCKED">Blocked</option></select></div>
      <button className="button">Apply filters</button>{filtered && <Link className="text-link" href="/activity">Clear filters</Link>}
      <details className="technical-details owner-filter-details" open={Boolean(params.capability || params.provider)}><summary>Technical filters</summary><div className="form-grid">
        <div className="field"><label htmlFor="activity-capability">Capability</label><input id="activity-capability" name="capability" defaultValue={params.capability} /></div>
        <div className="field"><label htmlFor="activity-provider">Provider</label><input id="activity-provider" name="provider" defaultValue={params.provider} /></div>
      </div></details>
    </form>
    <section className="card section-gap" aria-label="Activity timeline"><ActivityTimeline activity={activity} filtered={filtered} /></section>
  </>;
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listAgents } from "@/lib/agents";
import { AgentCreateForm } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";

export default async function AgentAdministrationPage() {
  const user = await requireUser();
  const agents = await listAgents(user.accountId);
  return <><PageHeader eyebrow="Advanced" title="Agent administration" description="Existing identity and credential tools. External-alpha Sofie provisioning is managed through MyEve installation." />
    <p className="notice">Do not create a replacement Sofie here. Creating an Agent is separate from installation, service connection and permission to execute Work.</p>
    <section className="grid two-col"><div className="card"><h2>Registered Agents</h2><ul className="owner-list">{agents.map((agent) => <li key={agent.id}><Link className="owner-row" href={`/agents/${agent.id}/advanced`}><strong>{agent.name}</strong><Status value={agent.status} /></Link></li>)}</ul>{!agents.length && <p className="subtle">No registered Agents. Complete MyEve setup for installation-managed provisioning.</p>}</div>
    <details className="card technical-details"><summary>Manual Agent creation</summary><p className="subtle">For existing development workflows only. This creates an independent identity and displays its credential once.</p><AgentCreateForm /></details></section>
  </>;
}

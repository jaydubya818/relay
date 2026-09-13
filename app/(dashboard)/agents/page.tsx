import Link from "next/link";
import { AgentCreateForm } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { getAgent, listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";

export default async function AgentsPage() {
  const user = await requireUser();
  const agents = listAgents(user.accountId);
  return (
    <>
      <PageHeader eyebrow="Plane" title="Agents" description="Durable identities with independent credentials and explicitly scoped access." />
      <section className="grid two-col">
        <div className="grid cards">
          {agents.map((agent) => {
            const detail = getAgent(user.accountId, agent.id);
            const allowed = detail.grants.filter((grant: any) => grant.effect === "ALLOW");
            return <Link className="card agent-card" href={`/agents/${agent.id}`} key={agent.id}>
              <div className="agent-top"><div><div className="agent-name">{agent.name}</div><div className="subtle">{agent.description || "No description"}</div></div><Status value={agent.status} /></div>
              <div className="cap-list">{allowed.map((grant: any) => <span className="cap" key={grant.capability}>{grant.capability}</span>)}</div>
              <div className="subtle" style={{ marginTop: 17 }}>Last active: {agent.lastActiveAt ? new Date(agent.lastActiveAt).toLocaleString() : "Never"}</div>
            </Link>;
          })}
          {!agents.length && <div className="card empty">No agents yet. Create one to issue a scoped Relay credential.</div>}
        </div>
        <AgentCreateForm />
      </section>
    </>
  );
}

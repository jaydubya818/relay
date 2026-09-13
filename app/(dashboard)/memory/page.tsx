import { ForgetMemoryButton } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import { dashboardMemories } from "@/lib/memory";

export default async function MemoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const memories = dashboardMemories(user.accountId, {
    query: params.query,
    type: params.type as any,
    scope: params.scope as any,
    createdByAgentId: params.agent,
  });
  const agents = listAgents(user.accountId);
  return (
    <>
      <PageHeader eyebrow="Capabilities" title="Memory" description="Search the durable account memory available across authorized agent runtimes." />
      <form className="filters card">
        <div className="field grow"><label>Search</label><input name="query" defaultValue={params.query} placeholder="Search memory content" /></div>
        <div className="field"><label>Type</label><select name="type" defaultValue={params.type ?? ""}><option value="">All types</option>{["FACT","PREFERENCE","PROJECT","DECISION","OTHER"].map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label>Scope</label><select name="scope" defaultValue={params.scope ?? ""}><option value="">All scopes</option><option>SHARED</option><option>AGENT_PRIVATE</option></select></div>
        <div className="field"><label>Created by</label><select name="agent" defaultValue={params.agent ?? ""}><option value="">All agents</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></div>
        <button className="button">Filter</button>
      </form>
      <div className="card flush table-wrap">
        <table><thead><tr><th>Memory</th><th>Type</th><th>Scope</th><th>Created by</th><th>Created</th><th /></tr></thead><tbody>{memories.map((memory: any) => <tr key={memory.id}><td className="memory-content">{memory.content}</td><td>{memory.type}</td><td><Status value={memory.scope} /></td><td>{memory.createdByAgent}</td><td className="subtle">{new Date(memory.createdAt).toLocaleString()}</td><td><ForgetMemoryButton id={memory.id} /></td></tr>)}</tbody></table>
        {!memories.length && <div className="empty">No memory matches these filters.</div>}
      </div>
    </>
  );
}

import { SandboxActions } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import { listSandboxes } from "@/lib/sandboxes";

export default async function SandboxesPage() {
  const user = await requireUser(); const [sandboxes, agents] = await Promise.all([listSandboxes(user.accountId), listAgents(user.accountId)]);
  return <><PageHeader eyebrow="Execution" title="Sandboxes" description="Agent-owned, time-bounded execution environments governed by Relay capabilities." action={<SandboxActions agents={agents.map(({ id, name }) => ({ id, name }))} />} /><div className="card flush table-wrap"><table><thead><tr><th>ID</th><th>Owner</th><th>Status</th><th>Provider</th><th>Created</th><th>Expires</th><th>Last used</th><th /></tr></thead><tbody>{sandboxes.map((sandbox) => <tr key={sandbox.id}><td className="mono">{sandbox.id}</td><td>{sandbox.ownerAgentName}</td><td><Status value={sandbox.status} /></td><td>{sandbox.provider}</td><td className="subtle">{new Date(sandbox.createdAt).toLocaleString()}</td><td className="subtle">{new Date(sandbox.expiresAt).toLocaleString()}</td><td className="subtle">{new Date(sandbox.lastUsedAt).toLocaleString()}</td><td>{sandbox.status === "RUNNING" && <SandboxActions agents={[]} sandboxId={sandbox.id} ownerAgentId={sandbox.ownerAgentId} />}</td></tr>)}</tbody></table>{!sandboxes.length && <div className="empty">No sandboxes. Create one for an Agent with sandbox.create authority.</div>}</div></>;
}

import { CopyButton, McpConnectionTest } from "@/components/actions";
import { PageHeader } from "@/components/page";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";

export default async function DeveloperPage() {
  const user = await requireUser();
  const agent = (await listAgents(user.accountId)).find((item) => item.status === "ACTIVE");
  const baseUrl = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:3000";
  const endpoint = `${baseUrl}/mcp`;
  const config = JSON.stringify({ mcpServers: { relay: { type: "http", url: endpoint, headers: { Authorization: "Bearer rly_YOUR_AGENT_CREDENTIAL" } } } }, null, 2);
  return (
    <>
      <PageHeader eyebrow="Developer" title="Relay MCP" description="Connect Claude, Codex, or any Streamable HTTP MCP client with a scoped agent credential." />
      <section className="grid two-col">
        <div className="stack">
          <div className="card">
            <h2>Connection</h2>
            <div className="kv"><div className="key">Endpoint</div><div className="inline"><span className="mono">{endpoint}</span><CopyButton value={endpoint} /></div><div className="key">Authentication</div><div>Bearer credential</div><div className="key">Suggested agent</div><div>{agent?.name ?? "Create an agent first"}</div><div className="key">Transport</div><div>Streamable HTTP</div></div>
          </div>
          <div className="card">
            <div className="inline"><h2>Generic MCP configuration</h2><span className="right"><CopyButton value={config} /></span></div>
            <pre className="code">{config}</pre>
          </div>
          <div className="card">
            <h2>Runtime notes</h2>
            <p className="subtle"><strong>Claude Code:</strong> add Relay as an HTTP MCP server and pass the agent credential in the Authorization header.</p>
            <p className="subtle"><strong>Codex:</strong> configure the same endpoint and header in your MCP server settings. Use a different Relay agent identity and credential for independent permissions and audit history.</p>
          </div>
        </div>
        <div className="card">
          <h2>Test connection</h2>
          <p className="subtle">Paste a Relay credential to verify authentication and inspect the tools projected for that agent. The credential is sent only to the local MCP endpoint and is not stored.</p>
          <div className="divider" />
          <McpConnectionTest />
        </div>
      </section>
    </>
  );
}

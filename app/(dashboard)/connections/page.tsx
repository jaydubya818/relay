export const metadata = { title: "Connections" };
import Link from "next/link";
import { PageHeader, Status, RelativeTime } from "@/components/page";
import { GitHubConnectionManager, GoogleConnectionManager } from "@/components/actions";
import { requireUser } from "@/lib/auth";
import { ownerConnections, ownerDirectory, capabilityProvider } from "@/lib/owner-workspace";
import { providerLabel } from "@/lib/owner-presentation";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(); const params = await searchParams;
  const [connections, agents] = await Promise.all([ownerConnections(user.accountId), ownerDirectory(user.accountId)]);
  const configured = { GITHUB: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET), GOOGLE: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) };
  const factoryConfigured = user.role === "OWNER" && user.accountId === process.env.MYFACTORY_RELAY_ACCOUNT_ID && Boolean(process.env.MYFACTORY_CLIENT_TOKEN);
  return <><PageHeader eyebrow="SERVICES & INTEGRATIONS" title="Connections" description="Connect your services once. Choose which Agents can use them." action={<Link className="button secondary" href="/agents">Review permissions</Link>} />
    {["github", "google"].map((provider) => { const result = params[provider]; if (!["connected", "failed", "cancelled"].includes(result ?? "")) return null; return <p key={provider} role="status" className={`notice ${result === "failed" ? "error" : ""}`}>{providerLabel(provider)}: {result === "connected" ? "Connected successfully." : result === "cancelled" ? "Authorization cancelled. Existing settings preserved." : "Authorization could not be completed. Review connection setup below."}</p>; })}
    <section className="card" aria-label="Service connections">{(["GITHUB", "GOOGLE"] as const).map((provider) => {
      const connection = connections.find((item) => item.provider.toUpperCase() === provider);
      const granted = agents.filter((agent) => agent.allowed.some((capability) => capabilityProvider(capability) === provider));
      const connected = connection?.status === "CONNECTED";
      return <article className="integration-record" key={provider}><div><div className="integration-identity"><span className="provider-mark" aria-hidden="true">{provider === "GITHUB" ? "GH" : "G"}</span><div><h2>{providerLabel(provider)}</h2><Status value={connection?.state ?? (configured[provider] ? "DISCONNECTED" : "REQUIRES_SETUP")} /></div></div><p className="subtle">{provider === "GITHUB" ? "Repository context for your research and development Agents." : "Read-only email and calendar access for your assistants."}</p><dl className="integration-details"><dt>Account</dt><dd>{connection?.displayName ?? "Not connected"}</dd><dt>Authentication</dt><dd>{connection?.authentication ?? "No credential stored"}</dd><dt>Health</dt><dd>{connection?.status === "ERROR" ? "Last recorded connection error. Run a check after reconnecting." : "Live health is checked on request; configuration alone is not a health check."}</dd><dt>Agents with grants</dt><dd>{granted.length ? granted.map((agent, index) => <span key={agent.id}>{index > 0 && ", "}<Link className="text-link" href={`/agents/${agent.id}?tab=connections`}>{agent.name}</Link>{agent.status !== "ACTIVE" && " (disabled)"}</span>) : "None"}</dd><dt>Permission scopes</dt><dd>{connection?.scopes.join(", ") || "No scopes recorded"}</dd><dt>Last successful use</dt><dd><RelativeTime value={connection?.lastSuccess} /></dd></dl></div><div className="integration-controls"><h3>{connected ? "Manage connection" : `Connect ${providerLabel(provider)}`}</h3>{provider === "GITHUB" ? <GitHubConnectionManager connected={connected} oauthConfigured={configured.GITHUB} /> : <GoogleConnectionManager connected={connected} oauthConfigured={configured.GOOGLE} />}</div></article>;
    })}</section>
    <section className="card section-gap"><div className="section-heading"><h2>MyFactory</h2><Status value={factoryConfigured ? "CONFIGURED" : "NOT_CONFIGURED"} /></div><p className="subtle">Bounded software execution through Sofie’s Work flow. Execution backends retain final admission authority.</p>{factoryConfigured ? <Link className="text-link" href="/activity?provider=MYFACTORY">View Work activity →</Link> : <p className="subtle">This workspace has no configured MyFactory route. Nothing has failed.</p>}</section>
    <p className="workspace-note">Agent access is derived from explicit grants, including Google’s email and calendar capabilities. A disabled Agent cannot use its grants. <Link className="text-link" href="/advanced/connections">Technical connection details →</Link></p>
  </>;
}

export const metadata = { title: "Connections" };
import Link from "next/link";
import { PageHeader, Status } from "@/components/page";
import { EmptyState } from "@/components/owner-ui";
import { requireUser } from "@/lib/auth";
import { listConnections } from "@/lib/connections";
import { providerLabel } from "@/lib/owner-presentation";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const connections = await listConnections(user.accountId);
  const params = await searchParams;
  const factoryConfigured = user.role === "OWNER" && user.accountId === process.env.MYFACTORY_RELAY_ACCOUNT_ID && Boolean(process.env.MYFACTORY_CLIENT_TOKEN);
  return <>
    <PageHeader eyebrow="Your Relay" title="Connections" description="Services connected to your account. Each Agent still needs its own permission to use them." />
    {["github", "google"].map((provider) => {
      const result = params[provider];
      if (!["connected", "failed", "cancelled"].includes(result ?? "")) return null;
      return <p className={`notice ${result === "failed" ? "error" : ""}`} role="status" key={provider}>{providerLabel(provider.toUpperCase())}: {result === "connected" ? "Connected successfully." : result === "cancelled" ? "Connection cancelled. Your existing settings have not been replaced." : "Authorization could not be completed. Review connection setup in Advanced."}</p>;
    })}
    <section className="grid cards">
      {connections.map((connection) => <article className="card" key={connection.id}><div className="owner-row"><h2 className="agent-name">{providerLabel(connection.provider)}</h2><Status value={connection.status} /></div><p>{connection.displayName}</p><p className="subtle">{connection.provider === "GITHUB" ? "Repository access for Agents with permission." : "Email and calendar access for Agents with permission."}</p><Link className="text-link" href="/advanced/connections">Manage connection<span className="sr-only"> for {providerLabel(connection.provider)}</span> →</Link></article>)}
      {factoryConfigured && <article className="card"><div className="owner-row"><h2>MyFactory</h2><Status value="CONFIGURED" /></div><p>Software engineering through your Sofie / MyEve Work flow.</p><p className="subtle">Routing is configured. Availability is confirmed when a Work request is admitted.</p><Link className="text-link" href="/activity?provider=MYFACTORY">View Work activity →</Link></article>}
    </section>
    {!connections.length && !factoryConfigured && <section className="card"><EmptyState title="No service connections yet">Connected services will appear here when setup is complete. You do not need to configure infrastructure to review your Agents or their activity.</EmptyState></section>}
    <section className="card section-gap"><h2>Connections and permissions work together</h2><p className="subtle">Only recorded account connections are shown here. A service that is not configured is not a failed connection. Additional setup depends on your release and is available in Advanced tools.</p><div className="owner-actions"><Link className="text-link" href="/agents">Review Agent permissions</Link><Link className="text-link" href="/advanced/connections">Advanced connection setup</Link></div></section>
  </>;
}

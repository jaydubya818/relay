import { GitHubConnectionManager } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { listConnections } from "@/lib/connections";

export default async function ConnectionsPage() {
  const user = await requireUser();
  const github = (await listConnections(user.accountId)).find((connection) => connection.provider === "GITHUB");
  return (
    <>
      <PageHeader eyebrow="Capabilities" title="Connections" description="Connect an external system once, then grant individual agents scoped capability access." />
      <section className="grid two-col">
        <div className="card">
          <div className="agent-top"><div><div className="agent-name">GitHub</div><div className="subtle">Repository read access through one account-owned connection.</div></div><Status value={github?.status ?? "NOT_CONNECTED"} /></div>
          <div className="kv" style={{ marginTop: 18 }}><div className="key">Account</div><div>{github?.displayName ?? "Not connected"}</div><div className="key">External ID</div><div className="mono subtle">{github?.externalAccountId ?? "—"}</div><div className="key">Capabilities</div><div>Repository read</div><div className="key">Agents with access</div><div>{github?.agentsWithAccess ?? 0}</div></div>
        </div>
        <div className="card">
          <h2>{github?.status === "CONNECTED" ? "Manage connection" : "Connect GitHub"}</h2>
          <p className="subtle">Use a fine-grained token with read-only access to the repositories Relay should expose. The token is encrypted at rest and never returned by the API.</p>
          <div className="divider" />
          <GitHubConnectionManager connected={github?.status === "CONNECTED"} />
        </div>
      </section>
    </>
  );
}

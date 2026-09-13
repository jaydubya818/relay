import { GitHubConnectionManager, GoogleConnectionManager } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { listConnections } from "@/lib/connections";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const connections = await listConnections(user.accountId);
  const github = connections.find((connection) => connection.provider === "GITHUB");
  const google = connections.find((connection) => connection.provider === "GOOGLE");
  return (
    <>
      <PageHeader eyebrow="Capabilities" title="Connections" description="Connect an external system once, then grant individual agents scoped capability access." />
      <section className="grid two-col">
        <div className="card">
          <div className="agent-top"><div><div className="agent-name">GitHub</div><div className="subtle">Repository read access through one account-owned connection.</div></div><Status value={github?.status ?? "NOT_CONNECTED"} /></div>
          <div className="kv" style={{ marginTop: 18 }}><div className="key">Account</div><div>{github?.displayName ?? "Not connected"}</div><div className="key">External ID</div><div className="mono subtle">{github?.externalAccountId ?? "—"}</div><div className="key">Scopes</div><div>{github?.scopes?.join(", ") || "—"}</div><div className="key">Capabilities</div><div>Repository read</div><div className="key">Agents with access</div><div>{github?.agentsWithAccess ?? 0}</div></div>
        </div>
        <div className="card">
          <h2>{github?.status === "CONNECTED" ? "Manage connection" : "Connect GitHub"}</h2>
          <p className="subtle">Connect GitHub once at the account level, then grant repository access to individual Agents.</p>
          {params.github === "connected" && <div className="notice">GitHub connected successfully.</div>}
          {params.github === "failed" && <div className="notice error">GitHub authorization could not be completed. Try connecting again.</div>}
          {params.github === "cancelled" && <div className="notice">GitHub authorization was cancelled.</div>}
          <div className="divider" />
          <GitHubConnectionManager connected={github?.status === "CONNECTED"} oauthConfigured={Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)} />
        </div>
      </section>
      <section className="grid two-col section-gap">
        <div className="card">
          <div className="agent-top"><div><div className="agent-name">Google Workspace</div><div className="subtle">Read-only Gmail and Calendar access through one account-owned connection.</div></div><Status value={google?.status ?? "NOT_CONNECTED"} /></div>
          <div className="kv" style={{ marginTop: 18 }}><div className="key">Account</div><div>{google?.displayName ?? "Not connected"}</div><div className="key">External ID</div><div className="mono subtle">{google?.externalAccountId ?? "—"}</div><div className="key">Scopes</div><div className="scope-list">{google?.scopes?.join(", ") || "—"}</div><div className="key">Capabilities</div><div>Email search/read · Calendar events/availability</div><div className="key">Agents with access</div><div>{google?.agentsWithAccess ?? 0}</div></div>
        </div>
        <div className="card"><h2>{google?.status === "CONNECTED" ? "Manage connection" : "Connect Google Workspace"}</h2><p className="subtle">OAuth credentials remain owned by the Account. Agents receive only explicit Relay grants.</p>{params.google === "connected" && <div className="notice">Google Workspace connected successfully.</div>}{params.google === "failed" && <div className="notice error">Google authorization could not be completed.</div>}{params.google === "cancelled" && <div className="notice">Google authorization was cancelled.</div>}<div className="divider" /><GoogleConnectionManager connected={google?.status === "CONNECTED"} oauthConfigured={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} /></div>
      </section>
    </>
  );
}

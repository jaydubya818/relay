import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { PageHeader, Status } from "@/components/page";
import { IntegrationRevoke } from "@/components/integration-revoke";
import { integrationOwner } from "@/lib/integrations/owner";
import { integrationStorageReady, ownerIntegrationConnections } from "@/lib/integrations/persistence";
import { db } from "@/lib/db";
import { agents, auditRecords } from "@/lib/db/schema";

export const metadata = { title: "Integration catalog" };
const activityLabels: Record<string, string> = {
  "integration.connection.confirmed": "Connection recorded", "integration.connection.revoked": "Relay access revoked",
  "integration.connection.provider-revoked": "Provider revocation confirmed", "integration.execution.denied": "Tool request blocked",
  "integration.event.received": "Provider event recorded",
};
const catalog = [
  { slug: "github", name: "GitHub", description: "Repository, issue, pull request and workflow context." },
  { slug: "gmail", name: "Gmail", description: "Authorized messages, search and email threads." },
  { slug: "googlecalendar", name: "Google Calendar", description: "Events and availability for your assistant." },
  { slug: "slack", name: "Slack", description: "Authorized channels and conversation context." },
];

export default async function IntegrationCatalog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.RELAY_INTEGRATIONS_PREVIEW !== "true") notFound();
  const owner = await integrationOwner();
  const params = await searchParams;
  const query = (params.q ?? "").slice(0, 200).toLowerCase();
  const matching = catalog.filter(app => `${app.name} ${app.description}`.toLowerCase().includes(query));
  let records: Awaited<ReturnType<typeof ownerIntegrationConnections>>["records"] = [];
  let nextCursor: string | null = null;
  let recent: Array<{ id: string; eventType: string; outcome: string }> = [];
  let directory: Array<{ id: string; name: string }> = [];
  let unavailable = false;
  try {
    if (!await integrationStorageReady()) unavailable = true;
    else {
      ({ records, nextCursor } = await ownerIntegrationConnections(owner.accountId, owner.ownerPrincipalId,
        { after: params.after || undefined, toolkits: matching.map(app => app.slug), connectedOnly: params.state === "connected" }));
      directory = await db().select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.accountId, owner.accountId));
      recent = await db().select({ id: auditRecords.id, eventType: auditRecords.eventType, outcome: auditRecords.outcome }).from(auditRecords)
        .where(and(eq(auditRecords.accountId, owner.accountId), sql`${auditRecords.details}->>'ownerPrincipalId' = ${owner.ownerPrincipalId}`, eq(auditRecords.provider, "composio")))
        .orderBy(desc(auditRecords.sequence)).limit(10);
    }
  } catch { unavailable = true; }
  const shown = matching.filter(app => params.state !== "connected" || records.some(record => record.binding.toolkit === app.slug));
  const pageLink = (after?: string) => `/connections/integrations?${new URLSearchParams({ q: query, state: params.state ?? "all", ...(after ? { after } : {}) })}`;
  return <><PageHeader eyebrow="SERVICES & INTEGRATIONS" title="Integration catalog" description="Review connected apps and the access assigned to each Agent." action={<Link className="button secondary" href="/connections">All connections</Link>} />
    <p className="notice"><strong>Integration qualification in progress.</strong> Live connection setup and remote tool execution are unavailable. Connecting an app does not grant execution permission.</p>
    {unavailable && <p role="alert" className="notice error">Connection records are unavailable. Refresh to try again. Setup may need to be completed by your administrator.</p>}
    <section className="card"><form className="directory-toolbar" method="get"><div className="field"><label htmlFor="integration-search">Search integrations</label><input id="integration-search" name="q" defaultValue={params.q} maxLength={200} placeholder="Search by app or task" /></div><div className="field"><label htmlFor="integration-state">Connection filter</label><select id="integration-state" name="state" defaultValue={params.state ?? "all"}><option value="all">All integrations</option><option value="connected">Connected apps</option></select></div><button className="button secondary">Search</button></form></section>
    {!shown.length && <section className="card"><h2>No integrations match these filters</h2><Link href="/connections/integrations" className="text-link">Clear filters</Link></section>}
    {(params.after || nextCursor) && <p className="notice">Showing up to 100 connection records per page, ordered by connection ID. Search and connection filters apply across all records.</p>}
    <section className="card" aria-label="Integration catalog">{shown.map(app => <article className="integration-record" key={app.slug}>
      <div><h2>{app.name}</h2><p className="subtle">{app.description}</p><p>Provider: Composio</p><p>Available in the catalog. Live setup requires qualification.</p></div>
      <div>{!records.some(record => record.binding.toolkit === app.slug) && <>{!params.after && !nextCursor && <Status value="REQUIRES_SETUP" />}<p>{params.after || nextCursor ? "No connection records for this app on this page." : "No recorded connection."}</p><button className="button secondary" disabled>Connection setup unavailable</button></>}
        {records.filter(record => record.binding.toolkit === app.slug).map(record => {
          const binding = record.binding;
          const status = binding.revokedAt ? "REVOKED" : binding.expiresAt && Date.parse(binding.expiresAt) <= Date.now() ? "EXPIRED" : binding.status;
          return <section className="integration-evidence" key={record.id} aria-label={`${app.name} connection`}><Status value={status} />
            <dl className="integration-details"><dt>Connection ID</dt><dd>{record.id}</dd><dt>Assigned Agent</dt><dd>{directory.find(agent => agent.id === binding.agentId)?.name ?? "Agent unavailable"}</dd>
              <dt>Credential custody</dt><dd>Composio. Credentials are not shown or copied into Relay.</dd>
              <dt>Granted scopes</dt><dd>{binding.scopes.join(", ") || "No scopes recorded"}</dd>
              <dt>Execution permission</dt><dd>Unavailable until canonical admission is qualified.</dd>
              <dt>Connection health</dt><dd>Stored provider status. Live health has not been checked by this page.</dd>
              <dt>Provider revocation</dt><dd>{record.providerRevocation === "NOT_REQUESTED" ? "Not requested" : record.providerRevocation === "CONFIRMED" ? "Confirmed" : "Pending — Relay access blocked"}</dd>
            </dl>{!binding.revokedAt && <IntegrationRevoke connectionId={record.id} />}
          </section>;
    })}</div></article>)}</section>
    {(params.after || nextCursor) && <nav className="directory-toolbar" aria-label="Connection pages">{params.after && <Link className="button secondary" href={pageLink()}>First connections</Link>}{nextCursor && <Link className="button secondary" href={pageLink(nextCursor)}>Next connections</Link>}</nav>}
    <section className="card"><h2>Recent integration activity</h2>{recent.length ? <ul>{recent.map(event => <li key={event.id}>{activityLabels[event.eventType] ?? "Integration activity recorded"}</li>)}</ul> : <p>No recorded integration activity.</p>}</section>
  </>;
}

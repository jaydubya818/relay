import { BrowserCloseButton } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { listBrowserSessions } from "@/lib/browsers";

export default async function BrowsersPage() {
  const user = await requireUser(); const sessions = await listBrowserSessions(user.accountId);
  return <><PageHeader eyebrow="Web access" title="Browsers" description="Isolated browser contexts owned by Agents, with bounded lifetimes and audited actions." /><div className="card flush table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th>Current URL</th><th>Provider</th><th>Created</th><th>Expires</th><th>Last activity</th><th /></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td>{session.ownerAgentName}</td><td><Status value={session.status} /></td><td className="mono subtle">{session.currentUrl ?? "—"}</td><td>{session.provider}</td><td className="subtle">{new Date(session.createdAt).toLocaleString()}</td><td className="subtle">{new Date(session.expiresAt).toLocaleString()}</td><td className="subtle">{new Date(session.lastUsedAt).toLocaleString()}</td><td><div className="inline">{session.status === "RUNNING" && <><a className="button secondary small" target="_blank" href={`/api/browsers/screenshot?agentId=${session.ownerAgentId}&browserSessionId=${session.id}`}>Screenshot</a><BrowserCloseButton browserSessionId={session.id} agentId={session.ownerAgentId} /></>}</div></td></tr>)}</tbody></table>{!sessions.length && <div className="empty">No active or historical browser sessions.</div>}</div></>;
}

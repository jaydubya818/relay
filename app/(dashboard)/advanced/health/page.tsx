export const metadata = { title: "System health" };
import { requireUser } from "@/lib/auth";
import { getOverview } from "@/lib/overview";
import { PageHeader, Status } from "@/components/page";
import { browserProvider, sandboxProvider } from "@/lib/providers";
import { runtimeActionsEnabled } from "@/lib/v2/deployment";

export default async function SystemHealthPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const overview = await getOverview(user.accountId);
  const probe = (await searchParams).probe === "1";
  const check = async (health: () => Promise<{ ok: boolean }>) => {
    if (!probe) return "NOT_CHECKED";
    try { return (await health()).ok ? "HEALTHY" : "UNAVAILABLE"; }
    catch { return "UNAVAILABLE"; }
  };
  const [sandbox, browser] = await Promise.all([
    check(() => sandboxProvider().health()), check(() => browserProvider().health()),
  ]);
  const rows = [
    ["Postgres", "HEALTHY", "Account queries completed for this request."],
    ["V2 runtime actions", runtimeActionsEnabled() ? "ENABLED" : "DISABLED", "Deployment policy; disabled is an intentional state, not a failed probe."],
    ["Sandbox provider", sandbox, "Local provider probe. Unavailable does not distinguish missing configuration from a stopped provider."],
    ["Browser provider", browser, "Local browser probe. No owner task is created."],
    ["GitHub OAuth", process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? "CONFIGURED" : "NOT_CONFIGURED", "OAuth configuration only; not a connection or health guarantee."],
    ["Google OAuth", process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "CONFIGURED" : "NOT_CONFIGURED", "OAuth configuration only; not a connection or health guarantee."],
    ["MCP", "NOT_CHECKED", "Use the credential-bound connection test in MCP tools."],
    ["Event worker", "NOT_CHECKED", "Stored event counts do not prove worker liveness."],
  ];
  return <><PageHeader eyebrow="Advanced" title="System health" description="Configuration, account resources and measured diagnostics. These are independent of your Agents’ permission grants." />
    <form className="owner-actions"><input type="hidden" name="probe" value="1" /><button className="button">Check local providers</button><span className="subtle">Checks Docker availability and briefly launches a local browser.</span></form>
    <section className="grid cards section-gap">{rows.map(([label, status, explanation]) => <article className="card" key={label}><div className="owner-row"><h2>{label}</h2><Status value={status} /></div><p className="subtle">{explanation}</p></article>)}</section>
    <section className="card section-gap"><h2>Account resources</h2><dl className="owner-facts"><dt>Running sandboxes</dt><dd>{overview.counts.sandboxes}</dd><dt>Browser sessions</dt><dd>{overview.counts.browsers}</dd><dt>Events</dt><dd>{overview.counts.events}</dd><dt>Unread inbox</dt><dd>{overview.counts.inbox}</dd><dt>Queued wakes</dt><dd>{overview.counts.wakes}</dd></dl></section>
  </>;
}

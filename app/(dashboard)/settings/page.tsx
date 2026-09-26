import { PageHeader } from "@/components/page";
import { canIssueBetaInvites, requireUser } from "@/lib/auth";
import { BetaInviteForm } from "@/components/beta-invite-form";
import { db } from "@/lib/db";
import { accounts, agentCredentials, memories } from "@/lib/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";

export default async function SettingsPage() {
  const user = await requireUser();
  const [[account], [credentialResult], [memoryResult]] = await Promise.all([
    db().select({ id: accounts.id, name: accounts.name, createdAt: accounts.createdAt }).from(accounts).where(eq(accounts.id, user.accountId)).limit(1),
    db().select({ value: count() }).from(agentCredentials).where(and(eq(agentCredentials.accountId, user.accountId), isNull(agentCredentials.revokedAt))),
    db().select({ value: count() }).from(memories).where(and(eq(memories.accountId, user.accountId), isNull(memories.forgottenAt))),
  ]);
  if (!account) throw new Error("Authenticated Relay account was not found.");
  const credentialCount = credentialResult.value;
  const memoryCount = memoryResult.value;
  return (
    <>
      <PageHeader eyebrow="Control" title="Settings" description="The small set of account, credential, and data controls needed for Relay V0." />
      <section className="grid two-col">
        <div className="stack">
          <div className="card"><h2>Account</h2><div className="kv"><div className="key">Name</div><div>{account.name}</div><div className="key">Account ID</div><div className="mono subtle">{account.id}</div><div className="key">Created</div><div>{new Date(account.createdAt).toLocaleString()}</div></div></div>
          <div className="card"><h2>Credentials</h2><p className="subtle">{credentialCount} active agent credential{credentialCount === 1 ? "" : "s"}. Credentials are hashed, shown once, independently revocable, and never recoverable.</p></div>
          <div className="card"><h2>Data</h2><p className="subtle">{memoryCount} active memories belong to this account. Forgotten memories are excluded from all active retrieval.</p></div>
        </div>
        <div className="card"><h2>Danger zone</h2><p className="subtle">Account deletion is intentionally deferred. V0 exposes scoped agent disable, credential revocation, connection removal, and memory forget controls without a broad destructive operation.</p></div>
        {canIssueBetaInvites(user) && <div className="card"><h2>Invite a beta tester</h2><p className="subtle">Create a private, email-bound Relay signup link. Send it only to the intended tester through a trusted channel.</p><BetaInviteForm /></div>}
      </section>
    </>
  );
}

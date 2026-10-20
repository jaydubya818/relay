export const metadata = { title: "Settings" };
import { PageHeader } from "@/components/page";
import { canIssueBetaInvites, requireUser } from "@/lib/auth";
import { BetaInviteForm } from "@/components/beta-invite-form";
import { BetaAccountRetirement } from "@/components/beta-account-retirement";
import { db } from "@/lib/db";
import { accounts, agentCredentials, memories } from "@/lib/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";

export default async function SettingsPage() {
  const user = await requireUser();
  const [[account], [credentialResult], [memoryResult]] = await Promise.all([
    db().select({ id: accounts.id, name: accounts.name, createdAt: accounts.createdAt, disposableBeta: accounts.disposableBeta }).from(accounts).where(eq(accounts.id, user.accountId)).limit(1),
    db().select({ value: count() }).from(agentCredentials).where(and(eq(agentCredentials.accountId, user.accountId), isNull(agentCredentials.revokedAt))),
    db().select({ value: count() }).from(memories).where(and(eq(memories.accountId, user.accountId), isNull(memories.forgottenAt))),
  ]);
  if (!account) throw new Error("Authenticated Relay account was not found.");
  const credentialCount = credentialResult.value;
  const memoryCount = memoryResult.value;
  return (
    <>
      <PageHeader eyebrow="Your Relay" title="Settings" description="Manage your account and review its security and data controls." />
      <section className="grid two-col">
        <div className="stack">
          <div className="card"><h2>Account</h2><div className="kv"><div className="key">Name</div><div>{account.name}</div><div className="key">Account ID</div><div className="mono subtle">{account.id}</div><div className="key">Created</div><div>{new Date(account.createdAt).toLocaleString()}</div></div></div>
          <details className="card technical-details"><summary>Advanced security details</summary><h2>Credentials</h2><p className="subtle">{credentialCount} active agent credential{credentialCount === 1 ? "" : "s"}. Credentials are hashed, shown once, independently revocable, and never recoverable.</p></details>
          <details className="card technical-details"><summary>Stored data details</summary><h2>Data</h2><p className="subtle">{memoryCount} active memories belong to this account. Forgotten memories are excluded from all active retrieval.</p></details>
        </div>
        <div className="card">{account.disposableBeta ? <BetaAccountRetirement accountId={account.id} /> : <><h2>Danger zone</h2><p className="subtle">Account-wide deletion is not available for this account. Individual Agent, credential and connection controls are available in Advanced tools.</p></>}</div>
        {canIssueBetaInvites(user) && <div className="card"><h2>Invite a beta tester</h2><p className="subtle">Create a private, email-bound Relay signup link. Send it only to the intended tester through a trusted channel.</p><BetaInviteForm /></div>}
      </section>
    </>
  );
}

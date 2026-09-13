import { PageHeader } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function SettingsPage() {
  const user = await requireUser();
  const account = db().prepare("SELECT id, name, created_at createdAt FROM accounts WHERE id = ?").get(user.accountId) as any;
  const credentialCount = (db().prepare("SELECT COUNT(*) count FROM agent_credentials WHERE account_id = ? AND revoked_at IS NULL").get(user.accountId) as any).count;
  const memoryCount = (db().prepare("SELECT COUNT(*) count FROM memories WHERE account_id = ? AND forgotten_at IS NULL").get(user.accountId) as any).count;
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
      </section>
    </>
  );
}

// Local Telegram qualification identities (isolated database only).
//   tsx scripts/qualification/telegram-identities.ts identities   # idempotent exact synthetic identities
//   tsx scripts/qualification/telegram-identities.ts pair <file>  # one-use pairing link -> 0600 file, never stdout
// The synthetic owner has no usable password: pairing is created here, so no
// owner web session, cookie or credential is involved. Refuses any database
// other than 127.0.0.1/relay_telegram_qualification (never the ledger port).
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { hashPassword } from "@/lib/crypto";
import { closeDatabase, withTransaction } from "@/lib/db";
import { rows } from "@/lib/v2/channels/store";
import { channelConfiguration } from "@/lib/v2/channels/config";
import { setupTelegramPairing } from "@/lib/v2/channels/management";
import { LOCAL_QUALIFICATION_IDENTITY as ID } from "@/lib/v2/channels/local-qualification";
import { activateV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";

const USER_ID = "qualification-user";
function assertIsolated() {
  const u = new URL(process.env.RELAY_DATABASE_URL ?? "");
  if (u.hostname !== "127.0.0.1" || u.port === "" || u.port === "55447" || u.pathname !== `/${ID.database}` || process.env.NODE_ENV !== "development")
    throw new Error("Refusing: not the isolated local qualification database.");
}

async function identities() {
  const signer = createLocalEd25519Signer();
  const created = await withTransaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('relay-telegram-qualification-identities'))`);
    const accounts = await rows<{ id: string }>(sql`SELECT id FROM accounts`, tx);
    if (accounts.length > 1 || (accounts.length === 1 && accounts[0].id !== ID.accountId)) throw new Error("Refusing: database holds other accounts.");
    if (accounts.length === 1) return false;
    const t = new Date().toISOString();
    await tx.execute(sql`INSERT INTO accounts(id,name,created_at,updated_at) VALUES(${ID.accountId},'Telegram qualification (synthetic)',${t},${t})`);
    // Unusable random password: the synthetic owner never signs in.
    await tx.execute(sql`INSERT INTO users(id,account_id,email,name,role,password_hash,created_at) VALUES(${USER_ID},${ID.accountId},'qualification-owner@relay.invalid','Qualification Owner','OWNER',${hashPassword(randomBytes(48).toString("base64url"))},${t})`);
    await tx.execute(sql`INSERT INTO principals(id,type,user_id,display_name,created_at,updated_at) VALUES(${ID.ownerPrincipalId},'HUMAN',${USER_ID},'Qualification Owner',${t},${t})`);
    await tx.execute(sql`INSERT INTO account_memberships(account_id,principal_id,role,created_at,updated_at) VALUES(${ID.accountId},${ID.ownerPrincipalId},'OWNER',${t},${t})`);
    await tx.execute(sql`INSERT INTO agents(id,account_id,name,description,status,created_at,updated_at) VALUES(${ID.agentId},${ID.accountId},'Sofie qualification','Synthetic Telegram qualification Agent','DRAFT',${t},${t})`);
    await appendAuditRecordInTransaction(tx, { accountId: ID.accountId, actorPrincipalId: ID.ownerPrincipalId, agentId: ID.agentId, eventType: "agent.created", outcome: "SUCCESS", occurredAt: t }, signer);
    return true;
  });
  if (created) {
    await issueAgentPassport({ accountId: ID.accountId, agentId: ID.agentId, ownerPrincipalId: ID.ownerPrincipalId, policy: { trustTier: "REGISTERED", capabilityEligibility: [], policyReferences: [], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "registered" }, dataAccess: [], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() } }, signer);
    await activateV2Agent({ accountId: ID.accountId, agentId: ID.agentId, actorPrincipalId: ID.ownerPrincipalId }, signer);
  }
  const [agent] = await rows<{ status: string }>(sql`SELECT status FROM agents WHERE id=${ID.agentId} AND account_id=${ID.accountId}`);
  // Never patch a partial identity set: the isolated Relay database holds no spend and is recreated instead.
  if (agent?.status !== "ACTIVE") throw new Error("Incomplete qualification identities; recreate the isolated Relay database.");
  console.log(JSON.stringify({ event: "qualification_identities", created, accountId: ID.accountId, ownerPrincipalId: ID.ownerPrincipalId, agentId: ID.agentId, agentStatus: agent?.status }));
}

async function pair(file: string | undefined) {
  if (!file || !file.startsWith("/")) throw new Error("Absolute output file required.");
  const config = channelConfiguration();
  if (config.accountId !== ID.accountId || config.ownerPrincipalId !== ID.ownerPrincipalId || config.agentId !== ID.agentId || config.connectionId !== ID.connectionId) throw new Error("Refusing: channel identity is not the qualification identity.");
  const { url, expiresAt } = await setupTelegramPairing(ID.accountId, ID.ownerPrincipalId, config);
  await writeFile(file, `${url}\n`, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ event: "pairing_link_written", file, expiresAt, bot: config.botUsername }));
}

(async () => {
  assertIsolated();
  const [mode, arg] = process.argv.slice(2);
  if (mode === "identities") await identities(); else if (mode === "pair") await pair(arg); else throw new Error("Usage: identities | pair <file>");
})().catch((error) => { console.error(JSON.stringify({ event: "qualification_identities_failed", message: error instanceof Error ? error.message : "failed" })); process.exitCode = 1; }).finally(closeDatabase);

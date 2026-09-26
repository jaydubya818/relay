import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { federationGrants, federationMessageDelegations } from "@/lib/db/schema";
import { createAgent } from "@/lib/agents";
import { id } from "@/lib/ids";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { registerFederationAgent, setAvailability } from "@/lib/v2/federation/registry";
import { authenticateMessageDelegation, authorizeDelegatedGrant, authorizeDelegatedRevoke, delegationToken, issueMessageDelegation, revokeMessageDelegation } from "@/lib/v2/federation/message-delegations";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

async function fixture() {
  const owner = await freshDatabase();
  const granteeOwnerId = await secondAccount();
  const source = await createAgent(owner.accountId, { name: "Source", capabilities: [] });
  const peer = await createAgent(granteeOwnerId, { name: "Peer", capabilities: [] });
  const signer = createLocalEd25519Signer();
  await registerFederationAgent({ accountId: owner.accountId, principalId: owner.principalId }, { agentId: source.agentId, platform: "test", capabilities: [], publicName: "Source" }, signer);
  await setAvailability({ accountId: owner.accountId, principalId: owner.principalId }, source.agentId, "ONLINE", signer);
  const issued = await issueMessageDelegation({ id: owner.userId, accountId: owner.accountId, email: "operator@example.com", name: "Operator", role: "OWNER" }, { agentId: source.agentId, granteeOwnerId, granteeAgentId: peer.agentId }, signer);
  const delegation = await authenticateMessageDelegation(issued.credential);
  if (!delegation) throw new Error("Fixture delegation missing");
  const grant = { grantorAgentId: source.agentId, granteeOwnerId, granteeAgentId: peer.agentId, capability: "message.send", resource: `relay://${owner.accountId}/${source.agentId}`, conditions: { expiresAt: new Date(Date.now() + 3600000).toISOString(), rateLimit: { calls: 10, windowSeconds: 3600 }, allowedTopics: [], approvalRequired: false } };
  return { owner, source, peer, signer, issued, delegation, grant };
}

afterEach(cleanupDatabase);

describe("seven-day peer message delegations", () => {
  it("issues a revocable opaque credential with an exact Agent and peer scope", async () => {
    const f = await fixture();
    expect(f.issued.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(f.issued.expiresAt) - Date.now()).toBeLessThanOrEqual(7 * 86400000);
    await expect(authorizeDelegatedGrant(f.delegation, f.grant)).resolves.toMatchObject({ capability: "message.send" });
    expect(delegationToken(new Request("https://relay.test", { headers: { authorization: `Bearer ${f.issued.credential}` } }))).toBe(f.issued.credential);
    const replacement = await issueMessageDelegation({ id: f.owner.userId, accountId: f.owner.accountId, email: "operator@example.com", name: "Operator", role: "OWNER" }, { agentId: f.source.agentId, granteeOwnerId: f.grant.granteeOwnerId, granteeAgentId: f.peer.agentId }, f.signer);
    await expect(authenticateMessageDelegation(f.issued.credential)).resolves.toBeNull();
    const active = await authenticateMessageDelegation(replacement.credential);
    expect(active).not.toBeNull();
    await revokeMessageDelegation(active!, f.signer);
    await expect(authenticateMessageDelegation(replacement.credential)).resolves.toBeNull();
  });

  it("rejects other capabilities, identities, resources, duration, and higher message rate", async () => {
    const f = await fixture();
    const changes = [
      { capability: "knowledge.query" },
      { granteeOwnerId: f.owner.accountId },
      { granteeAgentId: f.source.agentId },
      { grantorAgentId: f.peer.agentId },
      { resource: "private-memory" },
      { conditions: { ...f.grant.conditions, expiresAt: new Date(Date.parse(f.issued.expiresAt) + 1000).toISOString() } },
      { conditions: { ...f.grant.conditions, rateLimit: { calls: 10, windowSeconds: 60 } } },
      { conditions: { ...f.grant.conditions, rateLimit: { calls: 21, windowSeconds: 3600 } } },
    ];
    for (const change of changes) await expect(authorizeDelegatedGrant(f.delegation, { ...f.grant, ...change })).rejects.toMatchObject({ status: 403 });
    await db().update(federationMessageDelegations).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(federationMessageDelegations.id, f.delegation.id));
    await expect(authenticateMessageDelegation(f.issued.credential)).resolves.toBeNull();
  });

  it("only revokes grants within the same message scope", async () => {
    const f = await fixture();
    const allowedId = id("fgr");
    const deniedId = id("fgr");
    await db().insert(federationGrants).values([
      { id: allowedId, ownerId: f.owner.accountId, granteeOwnerId: f.grant.granteeOwnerId, capability: "message.send", resource: f.grant.resource, document: f.grant },
      { id: deniedId, ownerId: f.owner.accountId, granteeOwnerId: f.grant.granteeOwnerId, capability: "knowledge.query", resource: "private", document: { ...f.grant, capability: "knowledge.query", resource: "private" } },
    ]);
    await expect(authorizeDelegatedRevoke(f.delegation, allowedId)).resolves.toBeUndefined();
    await expect(authorizeDelegatedRevoke(f.delegation, deniedId)).rejects.toMatchObject({ status: 403 });
  });
});

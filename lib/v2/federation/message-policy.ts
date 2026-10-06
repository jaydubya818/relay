import { canonicalHash } from "@/lib/v2/contracts";
import type { PolicyRule } from "@/lib/v2/policy/contracts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agents, policyBundles } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { completePasswordStepUp, createStepUpChallenge, requireMembership } from "@/lib/v2/identity";
import { activateAccountPolicy, retireAccountPolicy, stageAccountPolicy } from "@/lib/v2/policy/service";

const peerSchema = z.object({ ownerId: z.string().min(1).max(255), agentId: z.string().min(1).max(255) }).strict();
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("stage"), agentId: z.string().min(1).max(255), peers: z.array(peerSchema).min(1).max(2) }).strict(),
  z.object({ operation: z.enum(["activate", "retire"]), agentId: z.string().min(1).max(255), bundleId: z.string().min(1).max(255), password: z.string().min(1).max(1024) }).strict(),
]);

function messageRules(agentId: string, peers: Array<z.infer<typeof peerSchema>>): PolicyRule[] {
  return peers.map((peer, index) => ({ id: `peer-${index + 1}`, effect: "ALLOW", reasonCode: "OWNER_APPROVED_PEER_MESSAGE",
    match: { capability: { name: "message.receive", version: "1.0" }, facts: {
      "federation.caller_owner": peer.ownerId, "federation.caller_agent": peer.agentId,
      "federation.target_agent": agentId, "federation.resource": "messages",
    } },
  }));
}
function sortedPeers(ownerId: string, value: unknown) {
  const peers = z.array(peerSchema).min(1).max(2).parse(value).sort((a,b) => `${a.ownerId}:${a.agentId}`.localeCompare(`${b.ownerId}:${b.agentId}`));
  if (peers.some(p => p.ownerId === ownerId) || new Set(peers.map(p => `${p.ownerId}:${p.agentId}`)).size !== peers.length) throw new RelayError("INVALID_INPUT", "Choose distinct external peers.");
  return peers;
}

/** Explicit, separately approved peer-message policy; Passport issuance never calls this. */
export async function manageMessagePolicy(owner: { accountId: string; principalId: string }, value: unknown, signer: AuditSigner) {
  await requireMembership({ ...owner, allowedRoles: ["OWNER"] });
  const command = commandSchema.parse(value);
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, command.agentId), eq(agents.accountId, owner.accountId))).limit(1);
  if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  const name = `peer-messages:${agent.id}`;
  if (command.operation === "stage") {
    const peers = sortedPeers(owner.accountId, command.peers);
    return stageAccountPolicy({ accountId: owner.accountId, actorPrincipalId: owner.principalId, name, layer: "ACCOUNT", rules: messageRules(agent.id, peers) }, signer);
  }
  const [bundle] = await db().select().from(policyBundles).where(and(eq(policyBundles.id, command.bundleId), eq(policyBundles.accountId, owner.accountId), eq(policyBundles.name, name), eq(policyBundles.layer, "ACCOUNT"))).limit(1);
  if (!bundle) throw new RelayError("INVALID_INPUT", "Message policy not found.", undefined, 404);
  const storedRules = z.array(z.object({ match: z.object({ facts: z.record(z.unknown()) }) })).min(1).max(2).parse(bundle.rules);
  const peers = sortedPeers(owner.accountId, storedRules.map(rule => ({ ownerId: rule.match.facts["federation.caller_owner"], agentId: rule.match.facts["federation.caller_agent"] })));
  const rules = messageRules(agent.id, peers);
  const document = { schemaVersion: "relay.policy-bundle.v1", accountId: owner.accountId, name, layer: "ACCOUNT", version: bundle.version, rules };
  if (canonicalHash(rules) !== canonicalHash(bundle.rules) || canonicalHash(document) !== bundle.bundleHash) throw new RelayError("INVALID_CREDENTIAL", "Exact message policy required.", undefined, 401);
  const actionClass = command.operation === "activate" ? "policy.activate" : "policy.retire";
  const challenge = await createStepUpChallenge({ ...owner, actionClass, actionHash: bundle.bundleHash, authenticationMethod: "password" });
  const stepUp = await completePasswordStepUp({ ...owner, secret: challenge.secret, password: command.password, actionClass, actionHash: bundle.bundleHash });
  const input = { accountId: owner.accountId, actorPrincipalId: owner.principalId, bundleId: bundle.id, stepUpChallengeId: stepUp.id };
  if (command.operation === "activate") await activateAccountPolicy(input, signer);
  else await retireAccountPolicy(input, signer);
  return { bundleId: bundle.id, bundleHash: bundle.bundleHash, status: command.operation === "activate" ? "ACTIVE" : "RETIRED" };
}

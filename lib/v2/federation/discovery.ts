import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agents, federationAgents, federationRelationships, publishedViews } from "@/lib/db/schema";
import { registrationSchema, viewSchema } from "./contracts";
import { assertNotBlocked } from "./registry";
import { authenticateFederationAgent, chargeRates } from "./service";
import { RelayError } from "@/lib/errors";

export async function discoverFederationAgents(secret: string, value: unknown) {
  const caller = await authenticateFederationAgent(secret);
  const input = z.object({ after: z.string().max(255).default(""), topic: z.string().max(100).optional() }).strict().parse(value);
  await chargeRates([{ accountId: caller.ownerId, key: `discovery:${caller.ownerId}`, limit: 10, seconds: 60 }]);
  const candidates = await db().select({ profile: federationAgents }).from(federationAgents).innerJoin(agents, and(eq(agents.id, federationAgents.agentId), eq(agents.status, "ACTIVE")))
    .where(and(gt(federationAgents.agentId, input.after), inArray(federationAgents.availability, ["ONLINE", "OFFLINE", "DEGRADED", "UNKNOWN"]), sql`${federationAgents.registration}->>'discovery' <> 'HIDDEN'`)).orderBy(asc(federationAgents.agentId)).limit(50);
  const results = [];
  for (const { profile } of candidates) {
    const registration = registrationSchema.parse(profile.registration);
    if (input.topic && !registration.topics.includes(input.topic)) continue;
    try { await assertNotBlocked(db(), caller, profile); } catch (error) { if (error instanceof RelayError) continue; throw error; }
    if (registration.discovery !== "PUBLIC") {
      const [relationship] = await db().select().from(federationRelationships).where(and(eq(federationRelationships.ownerId, profile.ownerId), inArray(federationRelationships.subject, [caller.ownerId, caller.agentId]), inArray(federationRelationships.trust, ["CONTACT", "TRUSTED"])));
      if (!relationship) continue;
    }
    const views = await db().select().from(publishedViews).where(and(eq(publishedViews.publisherAgentId, profile.agentId), eq(publishedViews.status, "ACTIVE")));
    const published = views.flatMap((view) => { const document = viewSchema.parse(view.document); return document.visibility === "PUBLIC" && Date.parse(document.expiresAt) > Date.now() ? [{ id: view.id, name: document.name, description: document.description, topics: document.topics, version: view.version }] : []; });
    results.push({ address: profile.address, name: registration.publicName, description: registration.publicDescription, topics: registration.topics, capabilities: registration.capabilities, views: published, verification: "OWNER_REGISTERED" });
  }
  return { agents: results, next: candidates.length === 50 ? candidates.at(-1)!.profile.agentId : null };
}

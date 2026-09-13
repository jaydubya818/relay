import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { capabilities } from "@/lib/db/schema";

export async function searchCapabilities(query = "", domain?: string, limit = 25) {
  const term = query.trim();
  return db().select({ id: capabilities.id, name: capabilities.name, version: capabilities.version, domain: capabilities.domain, description: capabilities.description, risk: capabilities.risk, provider: capabilities.provider, inputSchema: capabilities.inputSchema, outputSchema: capabilities.outputSchema, status: capabilities.status })
    .from(capabilities).where(and(eq(capabilities.enabled, true), ...(domain ? [eq(capabilities.domain, domain.toUpperCase())] : []), ...(term ? [or(ilike(capabilities.name, `%${term}%`), ilike(capabilities.description, `%${term}%`))!] : [])))
    .orderBy(asc(capabilities.name)).limit(Math.min(limit, 100));
}

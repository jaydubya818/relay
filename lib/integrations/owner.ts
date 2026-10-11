import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { principals } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/v2/identity";
import { IntegrationError } from "./contracts";

export async function integrationOwner() {
  const user = await requireUser();
  const [principal] = await db().select({ id: principals.id }).from(principals)
    .where(and(eq(principals.userId, user.id), eq(principals.status, "ACTIVE"))).limit(1);
  if (!principal) throw new IntegrationError("OWNER_REQUIRED");
  await requireMembership({ accountId: user.accountId, principalId: principal.id, allowedRoles: ["OWNER"] });
  return { accountId: user.accountId, ownerPrincipalId: principal.id };
}

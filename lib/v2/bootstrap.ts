import { sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "@/lib/crypto";
import { withTransaction } from "@/lib/db";
import { accountMemberships, accounts, principals, users } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";

const bootstrapInput = z.object({
  accountName: z.string().trim().min(1),
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(16),
});

export type BootstrapOwnerResult = {
  created: boolean;
  accountId: string;
  userId: string;
  principalId: string;
  email: string;
};

/**
 * Creates the single owner identity for an empty private-preview database.
 * Existing, exact state is returned unchanged; every other state fails closed.
 */
export async function bootstrapPrivatePreviewOwner(input: z.input<typeof bootstrapInput>): Promise<BootstrapOwnerResult> {
  if (process.env.RELAY_DEPLOYMENT_MODE !== "private-preview") {
    throw new Error("Owner bootstrap is restricted to RELAY_DEPLOYMENT_MODE=private-preview.");
  }

  const parsed = bootstrapInput.parse(input);
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('relay-private-preview-owner-bootstrap'))`);

    const existingAccounts = await transaction.select({ id: accounts.id, name: accounts.name }).from(accounts).limit(2);
    const existingUsers = await transaction.select({ id: users.id, accountId: users.accountId, email: users.email, name: users.name, role: users.role }).from(users).limit(2);
    const existingPrincipals = await transaction.select({ id: principals.id, type: principals.type, userId: principals.userId, displayName: principals.displayName, status: principals.status }).from(principals).limit(2);
    const existingMemberships = await transaction.select({ accountId: accountMemberships.accountId, principalId: accountMemberships.principalId, role: accountMemberships.role, status: accountMemberships.status }).from(accountMemberships).limit(2);

    if (existingAccounts.length === 0 && existingUsers.length === 0 && existingPrincipals.length === 0 && existingMemberships.length === 0) {
      const accountId = id("acct");
      const userId = id("usr");
      const principalId = id("prn");
      const timestamp = now();
      await transaction.insert(accounts).values({ id: accountId, name: parsed.accountName, createdAt: timestamp, updatedAt: timestamp });
      await transaction.insert(users).values({ id: userId, accountId, email: parsed.email, name: parsed.name, role: "OWNER", passwordHash: hashPassword(parsed.password), createdAt: timestamp });
      await transaction.insert(principals).values({ id: principalId, type: "HUMAN", userId, displayName: parsed.name, createdAt: timestamp, updatedAt: timestamp });
      await transaction.insert(accountMemberships).values({ accountId, principalId, role: "OWNER", createdAt: timestamp, updatedAt: timestamp });
      return { created: true, accountId, userId, principalId, email: parsed.email };
    }

    if (existingAccounts.length !== 1 || existingUsers.length !== 1 || existingPrincipals.length !== 1 || existingMemberships.length !== 1) {
      throw new Error("Owner bootstrap refused: the database is not an empty or single-owner private preview.");
    }

    const account = existingAccounts[0];
    const user = existingUsers[0];
    const principal = existingPrincipals[0];
    const membership = existingMemberships[0];

    const isExactOwner = account.name === parsed.accountName
      && user.accountId === account.id
      && user.email === parsed.email
      && user.name === parsed.name
      && user.role === "OWNER"
      && principal.type === "HUMAN"
      && principal.userId === user.id
      && principal.displayName === parsed.name
      && principal.status === "ACTIVE"
      && membership.accountId === account.id
      && membership.principalId === principal.id
      && membership.role === "OWNER"
      && membership.status === "ACTIVE";
    if (!isExactOwner) {
      throw new Error("Owner bootstrap refused: existing identity state does not exactly match the requested owner.");
    }

    return { created: false, accountId: account.id, userId: user.id, principalId: principal.id, email: user.email };
  });
}

import { and, eq, isNull, sql } from "drizzle-orm";
import type { RelayDatabase } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";

/** Serialize authority creation against disposable-account retirement. */
export async function lockActiveAccount(transaction: RelayDatabase, accountId: string) {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`federation:${accountId}`}, 0))`);
  const [account] = await transaction.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.retiredAt))).limit(1);
  if (!account) throw new RelayError("INVALID_CREDENTIAL", "Account is unavailable.", undefined, 403);
}

/** Revocation delivery remains possible after account retirement. */
export async function lockAccountDelivery(transaction: RelayDatabase, accountId: string) {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`federation:${accountId}`}, 0))`);
  const [account] = await transaction.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new RelayError("INVALID_CREDENTIAL", "Account is unavailable.", undefined, 403);
}

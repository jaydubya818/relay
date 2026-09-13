import { count, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db, withTransaction } from "@/lib/db";
import { accounts, capabilities } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("PostgreSQL migrations", () => {
  afterEach(cleanupDatabase);

  it("creates the V1 schema and canonical capability registry", async () => {
    await freshDatabase();
    const [result] = await db().select({ value: count() }).from(capabilities);
    expect(result.value).toBe(28);
    const inbox = await db().select({ name: capabilities.name }).from(capabilities).where(eq(capabilities.domain, "AGENT_INBOX"));
    expect(inbox.map((entry) => entry.name)).toEqual(expect.arrayContaining(["agent.inbox.list", "agent.inbox.get", "agent.inbox.ack"]));
  });

  it("rolls back authority-sensitive writes atomically", async () => {
    await freshDatabase();
    const accountId = id("acct");
    await expect(withTransaction(async (transaction) => {
      await transaction.insert(accounts).values({ id: accountId, name: "Must Roll Back", createdAt: now(), updatedAt: now() });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    const result = await db().select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
    expect(result).toHaveLength(0);
  });
});

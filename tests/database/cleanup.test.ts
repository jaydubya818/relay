import { Client } from "pg";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("isolated PostgreSQL fixture cleanup", () => {
  afterEach(cleanupDatabase);

  it("closes concurrent pooled clients before removing the fixture database", async () => {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      await freshDatabase();
      await Promise.all(Array.from({ length: 10 }, () => db().execute(sql`select pg_sleep(0.01)`)));
      await expect(cleanupDatabase()).resolves.toBeUndefined();
    }
  }, 20_000);

  it("reports a leaked connection without terminating it or losing the cleanup target", async () => {
    await freshDatabase();
    const leakedClient = new Client({ connectionString: process.env.RELAY_DATABASE_URL });
    await leakedClient.connect();
    try {
      await expect(cleanupDatabase()).rejects.toMatchObject({ code: "55006" });
      await expect(leakedClient.query("select 1 as alive")).resolves.toMatchObject({ rows: [{ alive: 1 }] });
    } finally {
      await leakedClient.end();
    }
    await expect(cleanupDatabase()).resolves.toBeUndefined();
    expect(process.env.RELAY_DATABASE_URL).toBeUndefined();
  }, 15_000);
});

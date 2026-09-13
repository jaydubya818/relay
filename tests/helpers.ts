import { Client } from "pg";
import { hashPassword } from "@/lib/crypto";
import { closeDatabasesForTests, db, migrateDatabase } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";

let databaseName: string | undefined;
const adminUrl = process.env.RELAY_TEST_DATABASE_URL ?? "postgresql://127.0.0.1:55432/postgres";

async function adminQuery(query: string) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try { await client.query(query); } finally { await client.end(); }
}

export async function freshDatabase() {
  await cleanupDatabase();
  databaseName = `relay_test_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await adminQuery(`CREATE DATABASE ${databaseName}`);
  process.env.RELAY_DATABASE_URL = new URL(databaseName, adminUrl.endsWith("/") ? adminUrl : `${adminUrl.slice(0, adminUrl.lastIndexOf("/") + 1)}`).toString();
  process.env.RELAY_SESSION_SECRET = "test-session-secret-with-enough-entropy";
  process.env.RELAY_ENCRYPTION_KEY = "test-encryption-key-with-enough-entropy";
  await migrateDatabase();
  const accountId = id("acct");
  const timestamp = now();
  await db().insert(accounts).values({ id: accountId, name: "Test Account", createdAt: timestamp, updatedAt: timestamp });
  await db().insert(users).values({ id: id("usr"), accountId, email: "operator@example.com", name: "Operator", role: "OWNER", passwordHash: hashPassword("correct-horse-battery-staple"), createdAt: timestamp });
  return { accountId };
}

export async function secondAccount() {
  const accountId = id("acct");
  const timestamp = now();
  await db().insert(accounts).values({ id: accountId, name: "Other Account", createdAt: timestamp, updatedAt: timestamp });
  return accountId;
}

export async function cleanupDatabase() {
  await closeDatabasesForTests();
  if (databaseName) {
    await adminQuery(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  }
  databaseName = undefined;
  delete process.env.RELAY_DATABASE_URL;
}

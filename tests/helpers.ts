import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "@/lib/crypto";
import { closeDatabasesForTests, db } from "@/lib/db";
import { id, now } from "@/lib/ids";

let directory: string | undefined;

export function freshDatabase() {
  closeDatabasesForTests();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), "relay-test-"));
  process.env.RELAY_DATABASE_PATH = join(directory, "relay.db");
  process.env.RELAY_SESSION_SECRET = "test-session-secret-with-enough-entropy";
  process.env.RELAY_ENCRYPTION_KEY = "test-encryption-key-with-enough-entropy";
  const accountId = id("acct");
  const timestamp = now();
  db().prepare("INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, 'Test Account', ?, ?)").run(accountId, timestamp, timestamp);
  db().prepare("INSERT INTO users (id, account_id, email, name, password_hash, created_at) VALUES (?, ?, 'operator@example.com', 'Operator', ?, ?)")
    .run(id("usr"), accountId, hashPassword("correct-horse-battery-staple"), timestamp);
  return { accountId };
}

export function secondAccount() {
  const accountId = id("acct");
  const timestamp = now();
  db().prepare("INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, 'Other Account', ?, ?)").run(accountId, timestamp, timestamp);
  return accountId;
}

export function cleanupDatabase() {
  closeDatabasesForTests();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
}

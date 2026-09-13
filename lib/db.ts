import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databases = new Map<string, DatabaseSync>();

function databasePath() {
  return resolve(process.env.RELAY_DATABASE_PATH ?? "data/relay.db");
}

export function db() {
  const path = databasePath();
  const existing = databases.get(path);
  if (existing) return existing;

  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(database);
  databases.set(path, database);
  return database;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DISABLED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agents_account_idx ON agents(account_id);
    CREATE TABLE IF NOT EXISTS agent_credentials (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS credentials_agent_idx ON agent_credentials(agent_id);
    CREATE TABLE IF NOT EXISTS capability_grants (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      effect TEXT NOT NULL CHECK(effect IN ('ALLOW', 'DENY')),
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, capability)
    );
    CREATE INDEX IF NOT EXISTS grants_agent_idx ON capability_grants(agent_id);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_by_agent_id TEXT NOT NULL REFERENCES agents(id),
      scope TEXT NOT NULL CHECK(scope IN ('SHARED', 'AGENT_PRIVATE')),
      type TEXT NOT NULL CHECK(type IN ('FACT', 'PREFERENCE', 'PROJECT', 'DECISION', 'OTHER')),
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      forgotten_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memories_account_active_idx ON memories(account_id, forgotten_at, created_at);
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('CONNECTED', 'DISCONNECTED', 'ERROR')),
      external_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, provider)
    );
    CREATE TABLE IF NOT EXISTS connection_credentials (
      connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
      encrypted_secret TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      session_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      provider TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'DENIED', 'FAILED')),
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS activity_account_created_idx ON activities(account_id, created_at DESC);
  `);
}

export function withTransaction<T>(work: () => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function closeDatabasesForTests() {
  for (const database of databases.values()) database.close();
  databases.clear();
}

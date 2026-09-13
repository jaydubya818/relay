import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

type RelayDatabase = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: RelayDatabase | undefined;
let activeUrl: string | undefined;

export function databaseUrl() {
  const url = process.env.RELAY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("RELAY_DATABASE_URL or DATABASE_URL is required in production.");
  }
  return "postgresql://127.0.0.1:5432/relay";
}

export function db() {
  const url = databaseUrl();
  if (database && activeUrl === url) return database;
  if (database && activeUrl !== url) {
    throw new Error("Relay database URL changed while a pool was active. Close the pool before changing databases.");
  }

  pool = new Pool({
    connectionString: url,
    max: Number(process.env.RELAY_DATABASE_POOL_SIZE ?? 10),
    connectionTimeoutMillis: Number(process.env.RELAY_DATABASE_CONNECT_TIMEOUT_MS ?? 5_000),
    idleTimeoutMillis: Number(process.env.RELAY_DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    application_name: "relay",
  });
  database = drizzle(pool, { schema });
  activeUrl = url;
  return database;
}

export async function migrateDatabase() {
  await migrate(db(), { migrationsFolder: "drizzle" });
}

export async function withTransaction<T>(work: (transaction: RelayDatabase) => Promise<T>): Promise<T> {
  return db().transaction(work);
}

export async function closeDatabase() {
  const currentPool = pool;
  pool = undefined;
  database = undefined;
  activeUrl = undefined;
  await currentPool?.end();
}

export const closeDatabasesForTests = closeDatabase;

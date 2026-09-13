import { Client } from "pg";
import { closeDatabase, migrateDatabase } from "../lib/db";
import { seedDemo } from "../lib/seed";

async function main() {
  const databaseUrl = process.env.RELAY_DATABASE_URL;
  if (!databaseUrl) throw new Error("RELAY_DATABASE_URL is required.");
  const target = new URL(databaseUrl);
  const databaseName = target.pathname.slice(1);
  if (!/^relay_e2e_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("Refusing to reset a database that is not named relay_e2e_*.");
  }

  const adminUrl = new URL(target);
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await client.end();
  }

  await migrateDatabase();
  await seedDemo();
  await closeDatabase();
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase();
  process.exitCode = 1;
});

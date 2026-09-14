import { closeDatabase, migrateDatabase } from "../lib/db";

async function main() {
  await migrateDatabase();
  await closeDatabase();
  console.log("Relay PostgreSQL database is ready.");
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase();
  process.exitCode = 1;
});

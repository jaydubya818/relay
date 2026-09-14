import { seedDemo } from "../lib/seed";
import { closeDatabase, migrateDatabase } from "../lib/db";

async function main() {
  await migrateDatabase();
  const result = await seedDemo();
  console.log(`Seeded ${result.email} in account ${result.accountId}.`);
  if (result.credentials.length) {
    console.log("New agent credentials (shown once):");
    for (const credential of result.credentials) console.log(`${credential.agent}: ${credential.secret}`);
  }
  console.log("Dashboard password is the configured RELAY_ADMIN_PASSWORD (local default: relay-local-only). ");
  await closeDatabase();
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase();
  process.exitCode = 1;
});

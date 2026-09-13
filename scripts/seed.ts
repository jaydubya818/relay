import { seedDemo } from "../lib/seed";

const result = seedDemo();
console.log(`Seeded ${result.email} in account ${result.accountId}.`);
if (result.credentials.length) {
  console.log("New agent credentials (shown once):");
  for (const credential of result.credentials) console.log(`${credential.agent}: ${credential.secret}`);
}
console.log("Dashboard password is the configured RELAY_ADMIN_PASSWORD (local default: relay-local-only). ");

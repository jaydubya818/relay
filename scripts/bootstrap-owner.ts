import { bootstrapPrivatePreviewOwner } from "../lib/v2/bootstrap";
import { closeDatabase } from "../lib/db";

async function main() {
  const result = await bootstrapPrivatePreviewOwner({
    accountName: process.env.RELAY_ACCOUNT_NAME ?? "Relay Private Preview",
    name: process.env.RELAY_ADMIN_NAME ?? "Relay Owner",
    email: process.env.RELAY_ADMIN_EMAIL ?? "",
    password: process.env.RELAY_ADMIN_PASSWORD ?? "",
  });
  console.log(JSON.stringify({
    event: "private_preview_owner_bootstrap",
    status: result.created ? "created" : "already_exists",
    accountId: result.accountId,
    userId: result.userId,
    principalId: result.principalId,
    email: result.email,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Owner bootstrap failed.");
  process.exitCode = 1;
}).finally(closeDatabase);

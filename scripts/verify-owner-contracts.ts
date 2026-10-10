import { execFileSync } from "node:child_process";

const frozen = "8a8678d675adc8ac7f799d7660071de2256bb231";
const paths = ["app/api", "lib/auth.ts", "lib/crypto.ts", "lib/authorization.ts", "lib/agents.ts", "lib/agent-sessions.ts", "lib/connections.ts", "lib/connectors", "lib/v2", "lib/db.ts", "lib/db/schema.ts", "lib/mcp.ts", "lib/myfactory.ts", "lib/myfactory-protocol.mjs", "lib/api.ts", "lib/executor.ts", "lib/types.ts", "drizzle", "sdks", "middleware.ts", "instrumentation.ts", "scripts/migrate.ts", "scripts/bootstrap-owner.ts", "components/beta-invite-form.tsx", "components/beta-account-retirement.tsx", "app/login", "app/signup"];
const contracts = paths.map((path) => {
  const before = execFileSync("git", ["ls-tree", frozen, "--", path], { encoding: "utf8" }).trim();
  const current = execFileSync("git", ["ls-tree", "HEAD", "--", path], { encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", frozen, "--", path], { encoding: "utf8" });
  return { path, identical: Boolean(before) && before === current && !diff, frozenEntry: before, candidateEntry: current };
});
console.log(JSON.stringify({ frozen, candidate: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), contracts }, null, 2));
if (contracts.some((contract) => !contract.identical)) process.exitCode = 1;

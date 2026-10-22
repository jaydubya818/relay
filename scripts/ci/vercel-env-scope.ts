/**
 * Vercel environment-scope guard.
 *
 * Fails when a database credential is exposed to Preview or Development
 * deployments. Production database variables must target Production only;
 * a branch-scoped Preview override is allowed only when it is listed in
 * scripts/ci/vercel-env-scope.allowlist.json (an isolated, non-production DB).
 *
 * Usage (CI):
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=team_... pnpm tsx scripts/ci/vercel-env-scope.ts relay
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type VercelEnvVar = {
  key: string;
  target?: string[];
  customEnvironmentIds?: string[];
  gitBranch?: string | null;
};

export type Allowlist = {
  /** "project/KEY@branch" entries for branch-scoped preview overrides that point at isolated databases. */
  branchOverrides: string[];
};

export type Violation = { project: string; key: string; targets: string[]; gitBranch?: string; reason: string };

const DATABASE_KEY =
  /(DATABASE_URL|^POSTGRES_(URL|PRISMA_URL|URL_NON_POOLING|URL_NO_SSL|PASSWORD|HOST|USER|DATABASE)$|^PG(HOST|PASSWORD|USER|DATABASE)(_UNPOOLED)?$|^NEON_PROJECT_ID$)/;

export function isDatabaseKey(key: string): boolean {
  return DATABASE_KEY.test(key);
}

export function findViolations(project: string, envs: VercelEnvVar[], allowlist: Allowlist): Violation[] {
  const allowed = new Set(allowlist.branchOverrides);
  const violations: Violation[] = [];
  for (const env of envs) {
    if (!isDatabaseKey(env.key)) continue;
    const targets = env.target ?? [];
    const nonProduction = targets.filter((t) => t !== "production");
    const custom = env.customEnvironmentIds ?? [];
    if (nonProduction.length === 0 && custom.length === 0) continue;
    const branch = env.gitBranch ?? undefined;
    if (branch && custom.length === 0 && !targets.includes("production") && allowed.has(`${project}/${env.key}@${branch}`)) continue;
    violations.push({
      project,
      key: env.key,
      targets: [...targets, ...custom.map((id) => `custom:${id}`)],
      gitBranch: branch,
      reason: branch
        ? "branch-scoped non-production database variable is not in the allowlist"
        : targets.includes("production")
          ? "production database variable is shared with non-production environments"
          : "database variable is exposed to every Preview/Development deployment",
    });
  }
  return violations;
}

async function listEnv(project: string, token: string, teamId: string): Promise<VercelEnvVar[]> {
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env?teamId=${encodeURIComponent(teamId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Vercel API ${response.status} for project ${project}`);
  const body = (await response.json()) as { envs?: VercelEnvVar[] };
  return body.envs ?? [];
}

async function main() {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projects = process.argv.slice(2);
  if (!token || !teamId || projects.length === 0) {
    console.error("usage: VERCEL_TOKEN=... VERCEL_TEAM_ID=... tsx scripts/ci/vercel-env-scope.ts <project> [project...]");
    process.exit(2);
  }
  const allowlist = JSON.parse(readFileSync(new URL("./vercel-env-scope.allowlist.json", import.meta.url), "utf8")) as Allowlist;
  const violations: Violation[] = [];
  for (const project of projects) violations.push(...findViolations(project, await listEnv(project, token, teamId), allowlist));
  if (violations.length === 0) {
    console.log(`vercel-env-scope: OK (${projects.join(", ")}) — database variables are Production-only`);
    return;
  }
  for (const v of violations) {
    console.error(`::error::${v.project}: ${v.key} [${v.targets.join(",")}${v.gitBranch ? `@${v.gitBranch}` : ""}] — ${v.reason}`);
  }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`::error::vercel-env-scope failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

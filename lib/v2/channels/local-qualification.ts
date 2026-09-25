type Env = Record<string, string | undefined>;

/**
 * Bounded, expiring, loopback-only qualification of the Telegram owner channel.
 * It never changes OWNER_EXECUTOR_QUALIFIED and cannot activate in a hosted,
 * preview, production or CI process. Every condition must hold on every
 * evaluation; callers re-evaluate per request and per worker cycle so expiry
 * closes execution without a restart. Cancellation still drains after expiry.
 */
export const LOCAL_QUALIFICATION_PROFILE = "telegram-owner-v1";
export const LOCAL_QUALIFICATION_MAX_WINDOW_MS = 60 * 60 * 1000;

/**
 * Exact synthetic identities in canonical Relay ID format (prefix_[A-Za-z0-9]{8,}),
 * mirrored by MyEve's live localOwnerQualification identity set.
 */
export const LOCAL_QUALIFICATION_IDENTITY = {
  accountId: "acct_qualificationrelay",
  ownerPrincipalId: "prn_qualificationowner",
  agentId: "agt_qualificationsofie",
  connectionId: "qualification-telegram-connection",
  audience: "myeve-local-qualification",
  executorPath: "/api/relay/owner-execution",
  database: "relay_telegram_qualification",
} as const;

/**
 * Reviewed pin for the dedicated qualification bot (lowercase, without "@").
 * Empty until the owner identifies the dedicated bot; adding one is a reviewed
 * source change. A personal bot must never be listed here.
 */
export const LOCAL_QUALIFICATION_BOT_USERNAMES: readonly string[] = [];

/** Any of these indicates a hosted, managed or CI runtime. */
export const HOSTED_RUNTIME_INDICATORS = [
  "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION", "VERCEL_DEPLOYMENT_ID", "VERCEL_PROJECT_ID", "NOW_REGION",
  "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RENDER", "FLY_APP_NAME", "K_SERVICE", "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV", "NETLIFY", "HEROKU_APP_NAME", "DYNO", "CI", "GITHUB_ACTIONS",
] as const;

/** Campaign model ledger port; Relay must never share it. */
const RESERVED_LEDGER_PORT = "55447";

export type LocalQualificationDecision =
  | { active: true; expiresAt: number }
  | { active: false; reason: LocalQualificationDenial };
export type LocalQualificationDenial =
  | "NOT_REQUESTED" | "HOSTED_RUNTIME" | "NOT_DEVELOPMENT" | "WINDOW_INVALID" | "EXPIRED"
  | "EXECUTOR_NOT_LOOPBACK" | "AUDIENCE_MISMATCH" | "DATABASE_NOT_ISOLATED" | "IDENTITY_MISMATCH" | "BOT_NOT_PINNED";

function loopbackHttpsExecutor(value: string | undefined) {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" && u.hostname === "127.0.0.1" && u.port !== "" && !u.username && !u.password
      && !u.search && !u.hash && u.pathname === LOCAL_QUALIFICATION_IDENTITY.executorPath;
  } catch { return false; }
}
function isolatedDatabase(value: string | undefined) {
  try {
    const u = new URL(value ?? "");
    return (u.protocol === "postgres:" || u.protocol === "postgresql:") && u.hostname === "127.0.0.1" && u.port !== ""
      && u.port !== RESERVED_LEDGER_PORT && u.pathname === `/${LOCAL_QUALIFICATION_IDENTITY.database}`
      && !u.searchParams.has("host");
  } catch { return false; }
}

/** Pure decision; `now` and the bot pin are injectable only for tests. */
export function localExecutorQualification(env: Env, now = Date.now(), pinnedBots: readonly string[] = LOCAL_QUALIFICATION_BOT_USERNAMES): LocalQualificationDecision {
  const deny = (reason: LocalQualificationDenial) => ({ active: false as const, reason });
  if (env.RELAY_LOCAL_QUALIFICATION !== LOCAL_QUALIFICATION_PROFILE) return deny("NOT_REQUESTED");
  if (HOSTED_RUNTIME_INDICATORS.some((name) => env[name] !== undefined && env[name] !== "")) return deny("HOSTED_RUNTIME");
  if (env.NODE_ENV !== "development" || env.RELAY_CHANNEL_ENVIRONMENT !== "development" || env.RELAY_DEPLOYMENT_MODE !== "local") return deny("NOT_DEVELOPMENT");
  const raw = env.RELAY_LOCAL_QUALIFICATION_UNTIL ?? "";
  const until = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(until) || until > now + LOCAL_QUALIFICATION_MAX_WINDOW_MS) return deny("WINDOW_INVALID");
  if (until <= now) return deny("EXPIRED");
  if (!loopbackHttpsExecutor(env.RELAY_OWNER_EXECUTOR_URL)) return deny("EXECUTOR_NOT_LOOPBACK");
  if (env.RELAY_OWNER_EXECUTOR_AUDIENCE !== LOCAL_QUALIFICATION_IDENTITY.audience) return deny("AUDIENCE_MISMATCH");
  // lib/db.ts resolves RELAY_DATABASE_URL first; any DATABASE_URL present must also be isolated.
  if (!isolatedDatabase(env.RELAY_DATABASE_URL ?? env.DATABASE_URL) || (env.DATABASE_URL !== undefined && !isolatedDatabase(env.DATABASE_URL))) return deny("DATABASE_NOT_ISOLATED");
  const id = LOCAL_QUALIFICATION_IDENTITY;
  if (env.RELAY_TELEGRAM_ACCOUNT_ID !== id.accountId || env.RELAY_TELEGRAM_OWNER_PRINCIPAL_ID !== id.ownerPrincipalId
    || env.RELAY_TELEGRAM_AGENT_ID !== id.agentId || env.RELAY_TELEGRAM_CONNECTION_ID !== id.connectionId) return deny("IDENTITY_MISMATCH");
  const bot = (env.RELAY_TELEGRAM_BOT_USERNAME ?? "").toLowerCase();
  if (!bot || !pinnedBots.map((name) => name.toLowerCase()).includes(bot)) return deny("BOT_NOT_PINNED");
  return { active: true, expiresAt: until };
}

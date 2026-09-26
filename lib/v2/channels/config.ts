import { configuredEd25519Signer } from "./signing";
import { OWNER_EXECUTOR_QUALIFIED,type Environment } from "./contracts";
import { localExecutorQualification } from "./local-qualification";

type Env = Record<string, string | undefined>;
/** Time-dependent: re-evaluate per request and per worker cycle, never cache. */
export function channelConfiguration(env: Env = process.env, now = Date.now()) {
  const issues: string[] = [];
  const required = (name: string) => { const value = env[name]; if (!value) issues.push(name); return value ?? ""; };
  const enabled = env.RELAY_TELEGRAM_ENABLED === "true";
  const requested = enabled && env.RELAY_TELEGRAM_EXECUTION_ENABLED === "true" && env.RELAY_DEPLOYMENT_MODE !== "private-preview";
  // The release constant stays false; only an exact, unexpired local qualification can stand in for it.
  const localQualification = requested && !OWNER_EXECUTOR_QUALIFIED ? localExecutorQualification(env, now) : null;
  const executionEnabled = requested && (OWNER_EXECUTOR_QUALIFIED || localQualification?.active === true);
  const environment = env.RELAY_CHANNEL_ENVIRONMENT as Environment;
  const connectionId = required("RELAY_TELEGRAM_CONNECTION_ID");
  const accountId = required("RELAY_TELEGRAM_ACCOUNT_ID");
  const ownerPrincipalId = required("RELAY_TELEGRAM_OWNER_PRINCIPAL_ID");
  const agentId = required("RELAY_TELEGRAM_AGENT_ID");
  const botUsername = required("RELAY_TELEGRAM_BOT_USERNAME");
  const botToken = required("RELAY_TELEGRAM_BOT_TOKEN");
  const webhookSecret = required("RELAY_TELEGRAM_WEBHOOK_SECRET");
  const endpoint = required("RELAY_OWNER_EXECUTOR_URL");
  const audience = required("RELAY_OWNER_EXECUTOR_AUDIENCE");
  const keyId = required("RELAY_CHANNEL_SIGNING_KEY_ID");
  const privateKey = required("RELAY_CHANNEL_SIGNING_PRIVATE_KEY");
  if (!env.RELAY_DATABASE_URL && !env.DATABASE_URL) issues.push("RELAY_DATABASE_URL");
  if (!env.RELAY_ENCRYPTION_KEY || env.RELAY_ENCRYPTION_KEY.length < 32) issues.push("RELAY_ENCRYPTION_KEY");
  if (!["development", "preview", "production"].includes(environment)) issues.push("RELAY_CHANNEL_ENVIRONMENT");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) issues.push("RELAY_TELEGRAM_WEBHOOK_SECRET");
  if (!/^[A-Za-z0-9_]{5,64}$/.test(botUsername)) issues.push("RELAY_TELEGRAM_BOT_USERNAME");
  try { const u = new URL(endpoint); if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw new Error(); } catch { issues.push("RELAY_OWNER_EXECUTOR_URL"); }
  let signer;
  try { signer = configuredEd25519Signer(keyId, privateKey); } catch { issues.push("RELAY_CHANNEL_SIGNING_PRIVATE_KEY"); }
  return { enabled, executionEnabled, localQualification, environment, connectionId, accountId, ownerPrincipalId, agentId, botUsername, botToken, webhookSecret, endpoint, audience, signer, issues: [...new Set(issues)] };
}
export type ChannelConfiguration = ReturnType<typeof channelConfiguration>;

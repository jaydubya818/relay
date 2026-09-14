import { RelayError } from "@/lib/errors";

export const DEPLOYMENT_MODES = ["local", "private-preview", "limited-beta", "production"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
type Environment = Record<string, string | undefined>;

export function deploymentMode(environment: Environment = process.env): DeploymentMode {
  const configured = environment.RELAY_DEPLOYMENT_MODE;
  if (!configured && environment.NODE_ENV !== "production") return "local";
  if (!DEPLOYMENT_MODES.includes(configured as DeploymentMode)) {
    throw new Error(`RELAY_DEPLOYMENT_MODE must be one of: ${DEPLOYMENT_MODES.join(", ")}.`);
  }
  return configured as DeploymentMode;
}

export function runtimeActionsEnabled(environment: Environment = process.env) {
  if (deploymentMode(environment) === "private-preview") return false;
  return environment.RELAY_V2_ACTIONS_ENABLED === "true";
}

export function requireRuntimeActionsEnabled(environment: Environment = process.env) {
  if (!runtimeActionsEnabled(environment)) {
    throw new RelayError(
      "CAPABILITY_DENIED",
      "Relay V2 runtime actions are disabled for this deployment.",
      undefined,
      503,
    );
  }
}

export function privatePreviewEnvironmentIssues(environment: Environment = process.env) {
  const issues: string[] = [];
  const requiredSecret = (name: string, minimumLength: number) => {
    if ((environment[name] ?? "").length < minimumLength) issues.push(`${name} must contain at least ${minimumLength} characters.`);
  };

  if (environment.RELAY_DEPLOYMENT_MODE !== "private-preview") issues.push("RELAY_DEPLOYMENT_MODE must be private-preview.");
  if (environment.RELAY_V2_ACTIONS_ENABLED !== "false") issues.push("RELAY_V2_ACTIONS_ENABLED must be explicitly set to false.");
  if (environment.RELAY_ALLOW_SIGNUP !== "false") issues.push("RELAY_ALLOW_SIGNUP must be explicitly set to false.");
  requiredSecret("RELAY_SESSION_SECRET", 32);
  requiredSecret("RELAY_ENCRYPTION_KEY", 32);
  requiredSecret("RELAY_ADMIN_PASSWORD", 16);
  if (!environment.RELAY_ADMIN_EMAIL) issues.push("RELAY_ADMIN_EMAIL is required.");

  const databaseUrl = environment.RELAY_DATABASE_URL ?? environment.DATABASE_URL;
  if (!databaseUrl) issues.push("RELAY_DATABASE_URL or DATABASE_URL is required.");
  else {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") issues.push("The database URL must use PostgreSQL.");
      if (parsed.searchParams.get("sslmode") !== "require") issues.push("The database URL must set sslmode=require.");
    } catch {
      issues.push("The database URL is invalid.");
    }
  }

  const publicUrl = environment.NEXT_PUBLIC_RELAY_URL;
  const issuerUrl = environment.RELAY_ISSUER_URL;
  for (const [name, value] of [["NEXT_PUBLIC_RELAY_URL", publicUrl], ["RELAY_ISSUER_URL", issuerUrl]] as const) {
    if (!value) issues.push(`${name} is required.`);
    else {
      try {
        if (new URL(value).protocol !== "https:") issues.push(`${name} must use HTTPS.`);
      } catch {
        issues.push(`${name} is invalid.`);
      }
    }
  }
  if (publicUrl && issuerUrl) {
    try {
      if (new URL(publicUrl).origin !== new URL(issuerUrl).origin) issues.push("RELAY_ISSUER_URL must use the Relay public origin.");
    } catch {
      // The individual URL checks above report malformed values.
    }
  }

  return issues;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { deploymentMode, privatePreviewEnvironmentIssues, requireRuntimeActionsEnabled, runtimeActionsEnabled } from "@/lib/v2/deployment";

describe("Relay V2 deployment safety", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults only non-production processes to local mode", () => {
    expect(deploymentMode({ NODE_ENV: "test" })).toBe("local");
    expect(() => deploymentMode({ NODE_ENV: "production" })).toThrow(/RELAY_DEPLOYMENT_MODE/);
  });

  it("keeps private-preview runtime actions disabled even when an enable flag is supplied", () => {
    const environment = { NODE_ENV: "production", RELAY_DEPLOYMENT_MODE: "private-preview", RELAY_V2_ACTIONS_ENABLED: "true" };
    expect(runtimeActionsEnabled(environment)).toBe(false);
    expect(() => requireRuntimeActionsEnabled(environment)).toThrow(/runtime actions are disabled/);
  });

  it("requires an explicit action enablement outside private preview", () => {
    expect(runtimeActionsEnabled({ NODE_ENV: "production", RELAY_DEPLOYMENT_MODE: "limited-beta" })).toBe(false);
    expect(runtimeActionsEnabled({ NODE_ENV: "production", RELAY_DEPLOYMENT_MODE: "limited-beta", RELAY_V2_ACTIONS_ENABLED: "true" })).toBe(true);
  });

  it("validates owner-only HTTPS and TLS deployment configuration without returning secret values", () => {
    const valid = {
      NODE_ENV: "production",
      RELAY_DEPLOYMENT_MODE: "private-preview",
      RELAY_V2_ACTIONS_ENABLED: "false",
      RELAY_ALLOW_SIGNUP: "false",
      RELAY_SESSION_SECRET: "s".repeat(32),
      RELAY_ENCRYPTION_KEY: "e".repeat(32),
      RELAY_ADMIN_EMAIL: "owner@example.com",
      RELAY_ADMIN_PASSWORD: "p".repeat(16),
      RELAY_DATABASE_URL: "postgresql://relay:secret@db.example.com/relay?sslmode=require",
      NEXT_PUBLIC_RELAY_URL: "https://relay.example.com",
      RELAY_ISSUER_URL: "https://relay.example.com",
    };
    expect(privatePreviewEnvironmentIssues(valid)).toEqual([]);
    expect(privatePreviewEnvironmentIssues({ ...valid, RELAY_ALLOW_SIGNUP: "true", RELAY_DATABASE_URL: "postgresql://localhost/relay", NEXT_PUBLIC_RELAY_URL: "http://relay.example.com" })).toEqual(expect.arrayContaining([
      "RELAY_ALLOW_SIGNUP must be explicitly set to false.",
      "The database URL must set sslmode=require.",
      "NEXT_PUBLIC_RELAY_URL must use HTTPS.",
    ]));
  });
});

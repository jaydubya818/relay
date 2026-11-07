import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { accountMemberships, agents, policyBundles, principals, runtimeClients, users } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { installHostedEnrollment } from "@/lib/v2/hosted-enrollment";
import { cleanupDatabase, freshDatabase } from "../helpers";

const PASSWORD = "correct-horse-battery-staple";
const permitPublicKey = () => { const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  return { keyId: "myeve-hosted-jay-source-test", jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } }; };

describe("hosted Sofie enrollment (owner + password step-up)", () => {
  afterEach(async () => { vi.restoreAllMocks(); await cleanupDatabase(); });

  it("refuses without step-up (403), with a wrong password (401) and for a non-owner (403), creating nothing", async () => {
    const identity = await freshDatabase(), signer = createLocalEd25519Signer("hosted-enrollment-test"), key = permitPublicKey();
    const owner = { accountId: identity.accountId, principalId: identity.principalId };
    await expect(installHostedEnrollment(owner, { installationId: "jay", permitPublicKey: key }, signer)).rejects.toMatchObject({ status: 403 });
    await expect(installHostedEnrollment(owner, { installationId: "jay", permitPublicKey: key, password: "wrong" }, signer)).rejects.toMatchObject({ status: 401 });
    const ts = now(), userId = id("usr"), principalId = id("prn");
    await db().insert(users).values({ id: userId, accountId: identity.accountId, email: "admin@example.com", name: "Admin", role: "MEMBER", passwordHash: hashPassword(PASSWORD), createdAt: ts });
    await db().insert(principals).values({ id: principalId, type: "HUMAN", userId, displayName: "Admin", createdAt: ts, updatedAt: ts });
    await db().insert(accountMemberships).values({ accountId: identity.accountId, principalId, role: "ADMIN", createdAt: ts, updatedAt: ts });
    await expect(installHostedEnrollment({ accountId: identity.accountId, principalId }, { installationId: "jay", permitPublicKey: key, password: PASSWORD }, signer))
      .rejects.toMatchObject({ status: 403 });
    expect(await db().select().from(agents).where(eq(agents.accountId, identity.accountId))).toHaveLength(0);
    expect(await db().select().from(runtimeClients).where(eq(runtimeClients.accountId, identity.accountId))).toHaveLength(0);
  });

  it("enrolls once, re-runs idempotently with a fresh token, records the permit public key, and never logs a secret", async () => {
    const identity = await freshDatabase(), signer = createLocalEd25519Signer("hosted-enrollment-test"), key = permitPublicKey();
    const owner = { accountId: identity.accountId, principalId: identity.principalId };
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); });
    const first = await installHostedEnrollment(owner, { installationId: "jay", permitPublicKey: key, password: PASSWORD }, signer);
    expect(first).toMatchObject({ installationId: "jay", accountId: identity.accountId, capability: { name: "resource.myfactory.admit", version: "1.0" }, permitKeyId: key.keyId });
    expect(first.agentId).toMatch(/^agt_/); expect(first.runtimeClientId).toMatch(/^rtc_/); expect(first.workloadId).toMatch(/^wkl_/);
    expect(typeof first.workloadToken).toBe("string"); expect(typeof first.runtimeClientCredential).toBe("string");
    const [policy] = await db().select().from(policyBundles).where(and(eq(policyBundles.accountId, identity.accountId), eq(policyBundles.name, "sofie-hosted-jay")));
    expect(policy?.status).toBe("ACTIVE");
    const [agent] = await db().select().from(agents).where(eq(agents.id, first.agentId));
    expect(JSON.parse(agent!.description)).toEqual({ installationId: "jay", permitPublicKey: key });

    const second = await installHostedEnrollment(owner, { installationId: "jay", permitPublicKey: key, password: PASSWORD }, signer);
    expect(second.agentId).toBe(first.agentId); expect(second.runtimeClientId).toBe(first.runtimeClientId); expect(second.policyBundleId).toBe(first.policyBundleId);
    expect(second.runtimeClientCredential).toBeNull(); expect(second.workloadToken).not.toBe(first.workloadToken);
    expect(await db().select().from(agents).where(eq(agents.accountId, identity.accountId))).toHaveLength(1);
    expect(await db().select().from(runtimeClients).where(eq(runtimeClients.accountId, identity.accountId))).toHaveLength(1);
    await expect(installHostedEnrollment(owner, { installationId: "jay", permitPublicKey: permitPublicKey(), password: PASSWORD }, signer)).rejects.toMatchObject({ status: 409 });

    const secrets = [first.workloadToken, second.workloadToken, first.runtimeClientCredential!, PASSWORD];
    for (const line of logged) for (const secret of secrets) expect(line.includes(secret)).toBe(false);
  });
});

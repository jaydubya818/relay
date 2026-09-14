import { afterEach, describe, expect, it } from "vitest";
import { authenticateServiceClient, completePasswordStepUp, createServicePrincipal, createStepUpChallenge, requireMembership, ROLE_PERMISSIONS, suspendPrincipal } from "@/lib/v2/identity";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

describe("Relay V2 identity and tenancy", () => {
  afterEach(cleanupDatabase);

  it("enforces account membership and baseline roles", async () => {
    const { accountId, principalId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    await expect(requireMembership({ accountId, principalId, allowedRoles: ["OWNER"] })).resolves.toMatchObject({ role: "OWNER", type: "HUMAN" });
    await expect(requireMembership({ accountId: otherAccountId, principalId })).rejects.toMatchObject({ status: 403 });
    await expect(requireMembership({ accountId, principalId, allowedRoles: ["AUDITOR"] })).rejects.toMatchObject({ status: 403 });
  });

  it("issues one-time service credentials without returning their hash", async () => {
    const { accountId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const service = await createServicePrincipal({ accountId, displayName: "Workflow worker", role: "OPERATOR" });
    expect(service.secret).toMatch(/^rsvc_/);
    await expect(requireMembership({ accountId, principalId: service.principalId, allowedRoles: ["OPERATOR"] })).resolves.toMatchObject({ type: "SERVICE" });
    await expect(authenticateServiceClient(service.secret, accountId)).resolves.toMatchObject({ principalId: service.principalId, role: "OPERATOR" });
    await expect(authenticateServiceClient(`${service.secret}x`, accountId)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateServiceClient(service.secret, otherAccountId)).rejects.toMatchObject({ status: 401 });
  });

  it("defines least-privilege permissions for every baseline role", () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(["OWNER", "ADMIN", "OPERATOR", "APPROVER", "MEMBER", "AUDITOR"]);
    expect(ROLE_PERMISSIONS.OWNER).toContain("account.manage");
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("account.manage");
    expect(ROLE_PERMISSIONS.APPROVER).toEqual(["approvals.decide", "audit.read"]);
    expect(ROLE_PERMISSIONS.AUDITOR).toEqual(["audit.read"]);
    expect(ROLE_PERMISSIONS.MEMBER).not.toContain("approvals.decide");
  });

  it("binds step-up authentication to account, principal, action, and one use", async () => {
    const { accountId, principalId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const challenge = await createStepUpChallenge({ accountId, principalId, actionClass: "policy.weaken", actionHash: `sha256:${"a".repeat(64)}`, authenticationMethod: "password" });
    await expect(completePasswordStepUp({ accountId: otherAccountId, principalId, secret: challenge.secret, password: "correct-horse-battery-staple", actionClass: "policy.weaken", actionHash: `sha256:${"a".repeat(64)}` })).rejects.toMatchObject({ status: 401 });
    await expect(completePasswordStepUp({ accountId, principalId, secret: challenge.secret, password: "wrong-password", actionClass: "policy.weaken", actionHash: `sha256:${"a".repeat(64)}` })).rejects.toMatchObject({ status: 401 });
    await expect(completePasswordStepUp({ accountId, principalId, secret: challenge.secret, password: "correct-horse-battery-staple", actionClass: "policy.weaken", actionHash: `sha256:${"b".repeat(64)}` })).rejects.toMatchObject({ status: 401 });
    await expect(completePasswordStepUp({ accountId, principalId, secret: challenge.secret, password: "correct-horse-battery-staple", actionClass: "policy.weaken", actionHash: `sha256:${"a".repeat(64)}` })).resolves.toMatchObject({ authenticationMethod: "password" });
    await expect(completePasswordStepUp({ accountId, principalId, secret: challenge.secret, password: "correct-horse-battery-staple", actionClass: "policy.weaken", actionHash: `sha256:${"a".repeat(64)}` })).rejects.toMatchObject({ status: 401 });
  });

  it("suspends the principal and rejects future membership checks", async () => {
    const { accountId, principalId } = await freshDatabase();
    await suspendPrincipal({ accountId, principalId });
    await expect(requireMembership({ accountId, principalId })).rejects.toMatchObject({ status: 403 });
  });
});

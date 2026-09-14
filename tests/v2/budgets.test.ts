import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { budgets } from "@/lib/db/schema";
import { createBudget, expireBudgetReservations, listBudgetEvents, listBudgets, reconcileBudgetReservation, releaseBudgetReservation, reserveBudget, setBudgetBalanceStatus } from "@/lib/v2/budgets";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { createV2Agent } from "@/lib/v2/passports";
import { capabilityDefinitionSchema } from "@/lib/v2/policy/contracts";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

async function setup() {
  const identity = await freshDatabase();
  const signer = createLocalEd25519Signer("budget-test-key");
  const agent = await createV2Agent({ accountId: identity.accountId, ownerPrincipalId: identity.principalId, name: "Budget Agent" }, signer);
  return { ...identity, agentId: agent.agentId, signer };
}

function future(minutes = 5) { return new Date(Date.now() + minutes * 60_000).toISOString(); }

describe("Relay V2 budget engine", () => {
  afterEach(cleanupDatabase);

  it("classifies every purchase-metered capability as financial", () => {
    const definition = { name: "money.purchase", version: "1.0", domain: "money", description: "Purchase", effectClass: "read", riskClass: "low", resourceType: "purchase", inputSchema: {}, outputSchema: {}, meteringDimensions: ["PURCHASE_AMOUNT"] };
    expect(capabilityDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  it("atomically prevents concurrent reservations from exceeding child and parent hard ceilings", async () => {
    const fixture = await setup();
    const parent = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "ACCOUNT", dimension: "TOKENS", unit: "token", hardLimit: "120" }, fixture.signer);
    const child = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, parentBudgetId: parent.budgetId, scope: "TASK", scopeId: "tsk_budget", dimension: "TOKENS", unit: "token", hardLimit: "100", softLimit: "90" }, fixture.signer);
    const attempts = await Promise.allSettled(Array.from({ length: 50 }, (_, index) => reserveBudget({ accountId: fixture.accountId, leafBudgetId: child.budgetId, agentId: fixture.agentId, taskId: "tsk_budget", actionIntentId: `act_${index}`, amount: "3", idempotencyKey: `reserve-${index}`, expiresAt: future() }, fixture.signer)));
    const successful = attempts.filter((result) => result.status === "fulfilled").length;
    expect(successful).toBe(33);
    const rows = await db().select().from(budgets);
    expect(rows.find((row) => row.id === child.budgetId)?.reservedAmount).toBe("99.000000000");
    expect(rows.find((row) => row.id === parent.budgetId)?.reservedAmount).toBe("99.000000000");
    expect((await listBudgetEvents(fixture.accountId)).some((event) => event.type === "SOFT_LIMIT_REACHED")).toBe(true);
  });

  it("rejects a child above parent remainder and enforces scoped authority", async () => {
    const fixture = await setup();
    const parent = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "ACCOUNT", dimension: "COMPUTE_SECONDS", unit: "second", hardLimit: "10" }, fixture.signer);
    await reserveBudget({ accountId: fixture.accountId, leafBudgetId: parent.budgetId, agentId: fixture.agentId, taskId: "tsk_one", actionIntentId: "act_one", amount: "4", idempotencyKey: "parent-use", expiresAt: future() }, fixture.signer);
    await expect(createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, parentBudgetId: parent.budgetId, scope: "TASK", scopeId: "tsk_one", dimension: "COMPUTE_SECONDS", unit: "second", hardLimit: "7" }, fixture.signer)).rejects.toMatchObject({ status: 409 });
    const child = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, parentBudgetId: parent.budgetId, scope: "TASK", scopeId: "tsk_one", dimension: "COMPUTE_SECONDS", unit: "second", hardLimit: "6" }, fixture.signer);
    await expect(reserveBudget({ accountId: fixture.accountId, leafBudgetId: child.budgetId, agentId: fixture.agentId, taskId: "tsk_other", actionIntentId: "act_other", amount: "1", idempotencyKey: "wrong-scope", expiresAt: future() }, fixture.signer)).rejects.toMatchObject({ status: 403 });
  });

  it("makes reservation and usage retries idempotent and reconciles exact amounts", async () => {
    const fixture = await setup();
    const budget = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "AGENT", scopeId: fixture.agentId, dimension: "MODEL_SPEND", unit: "minor_currency_unit", currency: "USD", hardLimit: "10.000000000" }, fixture.signer);
    const request = { accountId: fixture.accountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: "tsk_spend", actionIntentId: "act_spend", amount: "2.500000001", idempotencyKey: "same-reservation", expiresAt: future() };
    const first = await reserveBudget(request, fixture.signer);
    const replay = await reserveBudget(request, fixture.signer);
    expect(replay).toMatchObject({ reservationId: first.reservationId, idempotentReplay: true });
    const usage = { accountId: fixture.accountId, reservationId: first.reservationId, actualAmount: "2.250000001", usageIdempotencyKey: "same-usage", source: "model-provider", occurredAt: new Date().toISOString() };
    await expect(reconcileBudgetReservation(usage, fixture.signer)).resolves.toMatchObject({ status: "COMMITTED", idempotentReplay: false });
    await expect(reconcileBudgetReservation(usage, fixture.signer)).resolves.toMatchObject({ status: "COMMITTED", idempotentReplay: true });
    const [row] = await db().select().from(budgets).where(eq(budgets.id, budget.budgetId));
    expect(row).toMatchObject({ reservedAmount: "0.000000000", consumedAmount: "2.250000001" });
  });

  it("releases, expires, and marks unbounded reconciliation drift unknown", async () => {
    const fixture = await setup();
    const budget = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "ACCOUNT", dimension: "CONNECTOR_CALLS", unit: "call", hardLimit: "5" }, fixture.signer);
    const released = await reserveBudget({ accountId: fixture.accountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: "tsk_release", actionIntentId: "act_release", amount: "1", idempotencyKey: "release", expiresAt: future() }, fixture.signer);
    await releaseBudgetReservation({ accountId: fixture.accountId, reservationId: released.reservationId }, fixture.signer);
    await expect(releaseBudgetReservation({ accountId: fixture.accountId, reservationId: released.reservationId }, fixture.signer)).resolves.toMatchObject({ idempotentReplay: true });
    const expiring = await reserveBudget({ accountId: fixture.accountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: "tsk_expire", actionIntentId: "act_expire", amount: "1", idempotencyKey: "expire", expiresAt: future(1) }, fixture.signer);
    expect(await expireBudgetReservations(fixture.accountId, fixture.signer, future(2))).toBe(1);
    const drifting = await reserveBudget({ accountId: fixture.accountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: "tsk_drift", actionIntentId: "act_drift", amount: "2", idempotencyKey: "drift", expiresAt: future() }, fixture.signer);
    await expect(reconcileBudgetReservation({ accountId: fixture.accountId, reservationId: drifting.reservationId, actualAmount: "6", usageIdempotencyKey: "drift-usage", source: "connector", occurredAt: new Date().toISOString() }, fixture.signer)).resolves.toMatchObject({ status: "UNKNOWN" });
    const [row] = await db().select().from(budgets).where(eq(budgets.id, budget.budgetId));
    expect(row).toMatchObject({ consumedAmount: "6.000000000", balanceStatus: "UNKNOWN" });
    expect(expiring.reservationId).not.toBe(released.reservationId);
  });

  it("fails closed for stale or unknown purchase balances", async () => {
    const fixture = await setup();
    const budget = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "ACCOUNT", dimension: "PURCHASE_AMOUNT", unit: "minor_currency_unit", currency: "USD", hardLimit: "100" }, fixture.signer);
    await setBudgetBalanceStatus({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, budgetId: budget.budgetId, status: "UNKNOWN", balanceAsOf: new Date().toISOString() }, fixture.signer);
    const request = { accountId: fixture.accountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: "tsk_buy", actionIntentId: "act_buy", amount: "1", idempotencyKey: "unknown-buy", expiresAt: future() };
    await expect(reserveBudget(request, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await setBudgetBalanceStatus({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, budgetId: budget.budgetId, status: "CURRENT", balanceAsOf: new Date(Date.now() - 10 * 60_000).toISOString() }, fixture.signer);
    await expect(reserveBudget({ ...request, idempotencyKey: "stale-buy" }, fixture.signer)).rejects.toMatchObject({ status: 403 });
  });

  it("isolates budgets, reservations, status changes, and warning events by account", async () => {
    const fixture = await setup();
    const budget = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "ACCOUNT", dimension: "TOKENS", unit: "token", hardLimit: "10", softLimit: "1" }, fixture.signer);
    const otherAccountId = await secondAccount();
    await expect(reserveBudget({ accountId: otherAccountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: "tsk_cross", actionIntentId: "act_cross", amount: "1", idempotencyKey: "cross", expiresAt: future() }, fixture.signer)).rejects.toMatchObject({ status: 404 });
    await expect(setBudgetBalanceStatus({ accountId: otherAccountId, actorPrincipalId: fixture.principalId, budgetId: budget.budgetId, status: "UNKNOWN", balanceAsOf: new Date().toISOString() }, fixture.signer)).rejects.toMatchObject({ status: 403 });
    expect(await listBudgets(otherAccountId)).toEqual([]);
    expect(await listBudgetEvents(otherAccountId)).toEqual([]);
  });
});

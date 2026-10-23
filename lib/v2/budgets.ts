import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type RelayDatabase, withTransaction } from "@/lib/db";
import { agentDelegations, agents, budgetEvents, budgetReservations, budgets, budgetUsageRecords } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";

export const budgetDimensionSchema = z.enum(["TOKENS", "MODEL_SPEND", "CONNECTOR_CALLS", "COMPUTE_SECONDS", "COMPUTER_SECONDS", "PURCHASE_AMOUNT"]);
export const budgetScopeSchema = z.enum(["ACCOUNT", "AGENT", "TASK", "DELEGATION"]);
const amountSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/, "must be a non-negative decimal with at most 9 fractional digits");
const positiveAmountSchema = amountSchema.refine((value) => decimalUnits(value) > 0n, "must be greater than zero");

const SCALE = 1_000_000_000n;
function decimalUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(9, "0"));
}

function sameOptional(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? null) === (right ?? null);
}

async function lockAccount(transaction: RelayDatabase, accountId: string) {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`budget:${accountId}`}, 0))`);
}

async function loadBudgetChain(transaction: RelayDatabase, accountId: string, leafBudgetId: string) {
  const chain: Array<typeof budgets.$inferSelect> = [];
  const seen = new Set<string>();
  let currentId: string | null = leafBudgetId;
  while (currentId) {
    if (seen.has(currentId) || chain.length >= 16) throw new RelayError("INVALID_INPUT", "Budget hierarchy contains a cycle or exceeds 16 levels.", undefined, 409);
    seen.add(currentId);
    const [row] = await transaction.select().from(budgets).where(and(eq(budgets.accountId, accountId), eq(budgets.id, currentId))).limit(1);
    if (!row) throw new RelayError("INVALID_INPUT", "Budget not found in this account.", undefined, 404);
    chain.push(row);
    currentId = row.parentBudgetId;
  }
  return chain;
}

function validateChain(chain: Array<typeof budgets.$inferSelect>) {
  const leaf = chain[0]!;
  for (const budget of chain) {
    if (budget.dimension !== leaf.dimension || budget.unit !== leaf.unit || !sameOptional(budget.currency, leaf.currency)) {
      throw new RelayError("INVALID_INPUT", "Budget hierarchy dimensions, units, and currency must match.", undefined, 409);
    }
  }
}

function validateScope(budget: typeof budgets.$inferSelect, context: { agentIds: Set<string>; taskIds: Set<string>; delegationId?: string }) {
  const matches = budget.scope === "ACCOUNT" ? budget.scopeId === null : budget.scope === "AGENT" ? Boolean(budget.scopeId && context.agentIds.has(budget.scopeId)) : budget.scope === "TASK" ? Boolean(budget.scopeId && context.taskIds.has(budget.scopeId)) : sameOptional(budget.scopeId, context.delegationId);
  if (!matches) throw new RelayError("CAPABILITY_DENIED", "Budget scope does not authorize this action.", undefined, 403);
}

async function emitWarningIfNeeded(transaction: RelayDatabase, budget: typeof budgets.$inferSelect, requested: string) {
  if (!budget.softLimit) return;
  if (decimalUnits(budget.reservedAmount) + decimalUnits(budget.consumedAmount) + decimalUnits(requested) < decimalUnits(budget.softLimit)) return;
  await transaction.insert(budgetEvents).values({ id: id("bev"), accountId: budget.accountId, budgetId: budget.id, type: "SOFT_LIMIT_REACHED", payload: { requested, softLimit: budget.softLimit } });
}

export async function createBudget(input: { accountId: string; actorPrincipalId: string; parentBudgetId?: string; scope: z.infer<typeof budgetScopeSchema>; scopeId?: string; dimension: z.infer<typeof budgetDimensionSchema>; unit: string; currency?: string; hardLimit: string; softLimit?: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const parsed = z.object({ scope: budgetScopeSchema, dimension: budgetDimensionSchema, unit: z.string().min(1).max(64), currency: z.string().regex(/^[A-Z]{3}$/).optional(), hardLimit: positiveAmountSchema, softLimit: positiveAmountSchema.optional() }).parse(input);
  if ((parsed.scope === "ACCOUNT") !== !input.scopeId) throw new RelayError("INVALID_INPUT", "Account budgets omit scopeId; all other budgets require it.");
  if ((parsed.dimension === "PURCHASE_AMOUNT" || parsed.dimension === "MODEL_SPEND") !== Boolean(parsed.currency)) throw new RelayError("INVALID_INPUT", "Monetary dimensions require currency; non-monetary dimensions must omit it.");
  if (parsed.softLimit && decimalUnits(parsed.softLimit) > decimalUnits(parsed.hardLimit)) throw new RelayError("INVALID_INPUT", "Soft limit cannot exceed hard limit.");
  return await withTransaction(async (transaction) => {
    await lockAccount(transaction, input.accountId);
    if (input.parentBudgetId) {
      const chain = await loadBudgetChain(transaction, input.accountId, input.parentBudgetId);
      const parent = chain[0]!;
      if (parent.dimension !== parsed.dimension || parent.unit !== parsed.unit || !sameOptional(parent.currency, parsed.currency)) throw new RelayError("INVALID_INPUT", "Child budget must use its parent's dimension, unit, and currency.");
      const remainder = decimalUnits(parent.hardLimit) - decimalUnits(parent.reservedAmount) - decimalUnits(parent.consumedAmount);
      if (decimalUnits(parsed.hardLimit) > remainder) throw new RelayError("CAPABILITY_DENIED", "Child budget exceeds the parent's current remainder.", undefined, 409);
    }
    const budgetId = id("bdg");
    await transaction.insert(budgets).values({ id: budgetId, accountId: input.accountId, parentBudgetId: input.parentBudgetId, scope: parsed.scope, scopeId: input.scopeId, dimension: parsed.dimension, unit: parsed.unit, currency: parsed.currency, hardLimit: parsed.hardLimit, softLimit: parsed.softLimit });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, eventType: "budget.created", outcome: "SUCCESS", details: { budgetId, parentBudgetId: input.parentBudgetId ?? null, scope: parsed.scope, dimension: parsed.dimension, hardLimit: parsed.hardLimit } }, signer);
    return { budgetId };
  });
}

export async function reserveBudget(input: { accountId: string; leafBudgetId: string; agentId: string; taskId: string; actionIntentId: string; delegationId?: string; amount: string; idempotencyKey: string; expiresAt: string }, signer: AuditSigner) {
  return withTransaction((transaction) => reserveBudgetInTransaction(transaction, input, signer));
}

export async function reserveBudgetInTransaction(transaction: RelayDatabase, input: Parameters<typeof reserveBudget>[0], signer: AuditSigner) {
  const amount = positiveAmountSchema.parse(input.amount);
  const expiresAt = z.string().datetime({ offset: true }).parse(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.now()) throw new RelayError("INVALID_INPUT", "Budget reservation expiry must be in the future.");
    await lockAccount(transaction, input.accountId);
    const [existing] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) {
      if (existing.leafBudgetId !== input.leafBudgetId || existing.agentId !== input.agentId || existing.taskId !== input.taskId || existing.actionIntentId !== input.actionIntentId || existing.amount !== amount) throw new RelayError("INVALID_INPUT", "Budget reservation idempotency key was reused with different inputs.", undefined, 409);
      return { reservationId: existing.id, status: existing.status, idempotentReplay: true };
    }
    const chain = await loadBudgetChain(transaction, input.accountId, input.leafBudgetId);
    validateChain(chain);
    const [agent] = await transaction.select({ id: agents.id }).from(agents).where(and(eq(agents.accountId, input.accountId), eq(agents.id, input.agentId))).limit(1);
    if (!agent) throw new RelayError("CAPABILITY_DENIED", "Agent is unavailable in this account.", undefined, 403);
    const scopeContext = { agentIds: new Set([input.agentId]), taskIds: new Set([input.taskId]), delegationId: input.delegationId };
    if (input.delegationId) {
      if (chain[0]!.scope !== "DELEGATION" || chain[0]!.scopeId !== input.delegationId) throw new RelayError("CAPABILITY_DENIED", "Delegated reservations must use that delegation's leaf budget.", undefined, 403);
      const delegations = await transaction.select().from(agentDelegations).where(eq(agentDelegations.accountId, input.accountId)); let current = delegations.find((entry) => entry.id === input.delegationId && entry.childTaskId === input.taskId && entry.childAgentId === input.agentId && entry.status === "ACTIVE"); if (!current) throw new RelayError("CAPABILITY_DENIED", "Active delegation lineage is unavailable.", undefined, 403); const seen = new Set<string>(); while (current) { if (seen.has(current.id)) throw new RelayError("CAPABILITY_DENIED", "Delegation lineage contains a cycle.", undefined, 403); seen.add(current.id); scopeContext.taskIds.add(current.parentTaskId); scopeContext.agentIds.add(current.parentAgentId); current = current.parentDelegationId ? delegations.find((entry) => entry.id === current!.parentDelegationId && entry.status === "ACTIVE") : undefined; }
    }
    for (const budget of chain) {
      validateScope(budget, scopeContext);
      if (budget.status !== "ACTIVE") throw new RelayError("CAPABILITY_DENIED", "Budget is not active.", undefined, 403);
      if (budget.dimension === "PURCHASE_AMOUNT" && (budget.balanceStatus !== "CURRENT" || Date.parse(budget.balanceAsOf) < Date.now() - 5 * 60_000)) throw new RelayError("CAPABILITY_DENIED", "Purchase budget balance is stale or unknown.", undefined, 403);
      await emitWarningIfNeeded(transaction, budget, amount);
      const updated = await transaction.update(budgets).set({ reservedAmount: sql`${budgets.reservedAmount} + ${amount}`, updatedAt: now() }).where(and(eq(budgets.accountId, input.accountId), eq(budgets.id, budget.id), eq(budgets.status, "ACTIVE"), sql`${budgets.consumedAmount} + ${budgets.reservedAmount} + ${amount} <= ${budgets.hardLimit}`)).returning({ id: budgets.id });
      if (!updated.length) throw new RelayError("CAPABILITY_DENIED", "Budget hard limit would be exceeded.", undefined, 409);
    }
    const reservationId = id("res");
    const leaf = chain[0]!;
    await transaction.insert(budgetReservations).values({ id: reservationId, accountId: input.accountId, leafBudgetId: leaf.id, appliedBudgetIds: chain.map((budget) => budget.id), agentId: input.agentId, taskId: input.taskId, actionIntentId: input.actionIntentId, dimension: leaf.dimension, unit: leaf.unit, currency: leaf.currency, amount, idempotencyKey: input.idempotencyKey, expiresAt });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: input.agentId, taskId: input.taskId, actionIntentId: input.actionIntentId, eventType: "budget.reserved", outcome: "SUCCESS", details: { reservationId, leafBudgetId: leaf.id, appliedBudgetIds: chain.map((budget) => budget.id), dimension: leaf.dimension, amount } }, signer);
    return { reservationId, status: "RESERVED" as const, idempotentReplay: false };
}

async function releaseReservation(transaction: RelayDatabase, reservation: typeof budgetReservations.$inferSelect, status: "RELEASED" | "EXPIRED", signer: AuditSigner) {
  await transaction.update(budgets).set({ reservedAmount: sql`${budgets.reservedAmount} - ${reservation.amount}`, updatedAt: now() }).where(and(eq(budgets.accountId, reservation.accountId), inArray(budgets.id, reservation.appliedBudgetIds)));
  await transaction.update(budgetReservations).set({ status, reconciledAt: now() }).where(and(eq(budgetReservations.accountId, reservation.accountId), eq(budgetReservations.id, reservation.id), eq(budgetReservations.status, "RESERVED")));
  await appendAuditRecordInTransaction(transaction, { accountId: reservation.accountId, agentId: reservation.agentId, taskId: reservation.taskId, actionIntentId: reservation.actionIntentId, eventType: `budget.${status.toLowerCase()}`, outcome: status, details: { reservationId: reservation.id, amount: reservation.amount } }, signer);
}

export async function releaseBudgetReservation(input: { accountId: string; reservationId: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    await lockAccount(transaction, input.accountId);
    const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, input.reservationId))).limit(1);
    if (!reservation) throw new RelayError("INVALID_INPUT", "Budget reservation not found.", undefined, 404);
    if (reservation.status === "RELEASED") return { status: reservation.status, idempotentReplay: true };
    if (reservation.status !== "RESERVED") throw new RelayError("INVALID_INPUT", "Only an active reservation can be released.", undefined, 409);
    await releaseReservation(transaction, reservation, "RELEASED", signer);
    return { status: "RELEASED" as const, idempotentReplay: false };
  });
}

export async function expireBudgetReservations(accountId: string, signer: AuditSigner, timestamp = now()) {
  return await withTransaction(async (transaction) => {
    await lockAccount(transaction, accountId);
    const expired = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, accountId), eq(budgetReservations.status, "RESERVED"), sql`${budgetReservations.expiresAt} <= ${timestamp}`));
    for (const reservation of expired) await releaseReservation(transaction, reservation, "EXPIRED", signer);
    return expired.length;
  });
}

export async function reconcileBudgetReservation(input: { accountId: string; reservationId: string; actualAmount: string; usageIdempotencyKey: string; source: string; occurredAt: string }, signer: AuditSigner) {
  const actualAmount = amountSchema.parse(input.actualAmount);
  const occurredAt = z.string().datetime({ offset: true }).parse(input.occurredAt);
  return await withTransaction(async (transaction) => {
    await lockAccount(transaction, input.accountId);
    const [existingUsage] = await transaction.select().from(budgetUsageRecords).where(and(eq(budgetUsageRecords.accountId, input.accountId), eq(budgetUsageRecords.idempotencyKey, input.usageIdempotencyKey))).limit(1);
    if (existingUsage) {
      if (existingUsage.reservationId !== input.reservationId || existingUsage.amount !== actualAmount || existingUsage.source !== input.source) throw new RelayError("INVALID_INPUT", "Usage idempotency key was reused with different inputs.", undefined, 409);
      const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, input.reservationId))).limit(1);
      return { status: reservation?.status ?? "UNKNOWN", idempotentReplay: true };
    }
    const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, input.reservationId), eq(budgetReservations.status, "RESERVED"))).limit(1);
    if (!reservation) throw new RelayError("INVALID_INPUT", "Active budget reservation not found.", undefined, 404);
    const overage = decimalUnits(actualAmount) > decimalUnits(reservation.amount);
    let status: "COMMITTED" | "UNKNOWN" = "COMMITTED";
    if (overage) {
      const extra = decimalUnits(actualAmount) - decimalUnits(reservation.amount);
      const extraDecimal = `${extra / SCALE}.${(extra % SCALE).toString().padStart(9, "0")}`;
      const applied = await transaction.select().from(budgets).where(and(eq(budgets.accountId, input.accountId), inArray(budgets.id, reservation.appliedBudgetIds)));
      if (applied.length !== reservation.appliedBudgetIds.length || applied.some((budget) => decimalUnits(budget.consumedAmount) + decimalUnits(budget.reservedAmount) + extra > decimalUnits(budget.hardLimit))) status = "UNKNOWN";
      if (status === "COMMITTED") await transaction.update(budgets).set({ reservedAmount: sql`${budgets.reservedAmount} + ${extraDecimal}`, updatedAt: now() }).where(and(eq(budgets.accountId, input.accountId), inArray(budgets.id, reservation.appliedBudgetIds)));
      if (status === "UNKNOWN") {
        await transaction.update(budgets).set({ balanceStatus: "UNKNOWN", updatedAt: now() }).where(and(eq(budgets.accountId, input.accountId), inArray(budgets.id, reservation.appliedBudgetIds)));
      }
    }
    const reservedToRelease = overage && status === "COMMITTED" ? actualAmount : reservation.amount;
    await transaction.update(budgets).set({ reservedAmount: sql`GREATEST(0, ${budgets.reservedAmount} - ${reservedToRelease})`, consumedAmount: sql`${budgets.consumedAmount} + ${actualAmount}`, updatedAt: now() }).where(and(eq(budgets.accountId, input.accountId), inArray(budgets.id, reservation.appliedBudgetIds)));
    await transaction.insert(budgetUsageRecords).values({ id: id("bus"), accountId: input.accountId, reservationId: reservation.id, leaseId: reservation.leaseId, dimension: reservation.dimension, amount: actualAmount, idempotencyKey: input.usageIdempotencyKey, source: input.source, occurredAt });
    await transaction.update(budgetReservations).set({ status, actualAmount, reconciledAt: now() }).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, reservation.id)));
    if (status === "UNKNOWN") for (const budgetId of reservation.appliedBudgetIds) await transaction.insert(budgetEvents).values({ id: id("bev"), accountId: input.accountId, budgetId, type: "USAGE_OVERAGE_UNKNOWN", payload: { reservationId: reservation.id, reserved: reservation.amount, actual: actualAmount } });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: reservation.agentId, taskId: reservation.taskId, actionIntentId: reservation.actionIntentId, eventType: "budget.reconciled", outcome: status, details: { reservationId: reservation.id, reservedAmount: reservation.amount, actualAmount, usageIdempotencyKey: input.usageIdempotencyKey } }, signer);
    return { status, idempotentReplay: false };
  });
}

export async function markBudgetReservationUnknown(input: { accountId: string; reservationId: string; reason: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    await lockAccount(transaction, input.accountId);
    const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, input.reservationId))).limit(1);
    if (!reservation) throw new RelayError("INVALID_INPUT", "Budget reservation not found.", undefined, 404);
    if (reservation.status === "UNKNOWN") return { status: "UNKNOWN" as const, idempotentReplay: true };
    if (reservation.status !== "RESERVED") throw new RelayError("INVALID_INPUT", "Only an active reservation can become unknown.", undefined, 409);
    await transaction.update(budgetReservations).set({ status: "UNKNOWN", reconciledAt: now() }).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, reservation.id), eq(budgetReservations.status, "RESERVED")));
    await transaction.update(budgets).set({ balanceStatus: "UNKNOWN", updatedAt: now() }).where(and(eq(budgets.accountId, input.accountId), inArray(budgets.id, reservation.appliedBudgetIds)));
    for (const budgetId of reservation.appliedBudgetIds) await transaction.insert(budgetEvents).values({ id: id("bev"), accountId: input.accountId, budgetId, type: "EFFECT_UNKNOWN", payload: { reservationId: reservation.id, reason: input.reason } });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: reservation.agentId, taskId: reservation.taskId, actionIntentId: reservation.actionIntentId, eventType: "budget.effect_unknown", outcome: "UNKNOWN", details: { reservationId: reservation.id, reason: input.reason } }, signer);
    return { status: "UNKNOWN" as const, idempotentReplay: false };
  });
}

export async function setBudgetBalanceStatus(input: { accountId: string; actorPrincipalId: string; budgetId: string; status: "CURRENT" | "STALE" | "UNKNOWN"; balanceAsOf: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const balanceAsOf = z.string().datetime({ offset: true }).parse(input.balanceAsOf);
  await withTransaction(async (transaction) => {
    await lockAccount(transaction, input.accountId);
    const updated = await transaction.update(budgets).set({ balanceStatus: input.status, balanceAsOf, updatedAt: now() }).where(and(eq(budgets.accountId, input.accountId), eq(budgets.id, input.budgetId))).returning({ id: budgets.id });
    if (!updated.length) throw new RelayError("INVALID_INPUT", "Budget not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, eventType: "budget.balance_status_changed", outcome: input.status, details: { budgetId: input.budgetId, balanceAsOf } }, signer);
  });
}

export async function listBudgets(accountId: string) {
  return await db().select().from(budgets).where(eq(budgets.accountId, accountId)).orderBy(asc(budgets.createdAt));
}

export async function listBudgetEvents(accountId: string) {
  return await db().select().from(budgetEvents).where(eq(budgetEvents.accountId, accountId)).orderBy(asc(budgetEvents.createdAt));
}

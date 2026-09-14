import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMemberships,
  agentPassports,
  agents,
  approvalRequests,
  auditRecords,
  budgets,
  communicationConnections,
  communicationMessages,
  computerControlSessions,
  connectorConnections,
  deadLetterEntries,
  executionPlacements,
  financialAccounts,
  policyBundles,
  principals,
  purchaseIntents,
  runners,
  runtimeClients,
  users,
  v2Tasks,
} from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";

export async function operatorContext(accountId: string, userId: string) {
  const [operator] = await db().select({ principalId: principals.id, displayName: principals.displayName, role: accountMemberships.role }).from(users)
    .innerJoin(principals, eq(principals.userId, users.id))
    .innerJoin(accountMemberships, and(eq(accountMemberships.principalId, principals.id), eq(accountMemberships.accountId, accountId), eq(accountMemberships.status, "ACTIVE")))
    .where(and(eq(users.id, userId), eq(users.accountId, accountId), eq(principals.status, "ACTIVE"))).limit(1);
  if (!operator) throw new RelayError("CAPABILITY_DENIED", "Active V2 operator membership is required.", undefined, 403);
  return operator;
}

export async function getV2Dashboard(accountId: string) {
  const [taskRows, approvalRows, agentRows, passportRows, computerRows, communicationRows, communicationMessageRows, connectorRows, budgetRows, policyRows, runnerRows, placementRows, financialRows, purchaseRows, runtimeRows, activityRows, deadLetters] = await Promise.all([
    db().select({ id: v2Tasks.id, agentId: v2Tasks.agentId, status: v2Tasks.status, attemptCount: v2Tasks.attemptCount, maxAttempts: v2Tasks.maxAttempts, preferredRuntime: v2Tasks.preferredRuntime, createdAt: v2Tasks.createdAt, updatedAt: v2Tasks.updatedAt }).from(v2Tasks).where(eq(v2Tasks.accountId, accountId)).orderBy(desc(v2Tasks.createdAt)).limit(100),
    db().select({ id: approvalRequests.id, actionIntentId: approvalRequests.actionIntentId, agentId: approvalRequests.agentId, taskId: approvalRequests.taskId, approvalClass: approvalRequests.approvalClass, riskClass: approvalRequests.riskClass, effectClass: approvalRequests.effectClass, summary: approvalRequests.summary, consequence: approvalRequests.consequence, displayEvidence: approvalRequests.displayEvidence, allowedScopes: approvalRequests.allowedScopes, status: approvalRequests.status, createdAt: approvalRequests.createdAt, expiresAt: approvalRequests.expiresAt }).from(approvalRequests).where(eq(approvalRequests.accountId, accountId)).orderBy(desc(approvalRequests.createdAt)).limit(100),
    db().select({ id: agents.id, name: agents.name, description: agents.description, status: agents.status, createdAt: agents.createdAt }).from(agents).where(eq(agents.accountId, accountId)).orderBy(desc(agents.createdAt)).limit(100),
    db().select({ id: agentPassports.id, agentId: agentPassports.agentId, version: agentPassports.version, trustTier: agentPassports.trustTier, status: agentPassports.status, validFrom: agentPassports.validFrom, expiresAt: agentPassports.expiresAt }).from(agentPassports).where(eq(agentPassports.accountId, accountId)).orderBy(desc(agentPassports.createdAt)).limit(100),
    db().select({ id: computerControlSessions.id, taskId: computerControlSessions.taskId, placementId: computerControlSessions.placementId, controller: computerControlSessions.controller, fenceToken: computerControlSessions.fenceToken, activeInputCount: computerControlSessions.activeInputCount, credentialEntryMode: computerControlSessions.credentialEntryMode, lastIntegrityHash: computerControlSessions.lastIntegrityHash, expiresAt: computerControlSessions.expiresAt, updatedAt: computerControlSessions.updatedAt }).from(computerControlSessions).where(eq(computerControlSessions.accountId, accountId)).orderBy(desc(computerControlSessions.updatedAt)).limit(100),
    db().select({ id: communicationConnections.id, provider: communicationConnections.provider, externalAccountId: communicationConnections.externalAccountId, ownedIdentityId: communicationConnections.ownedIdentityId, status: communicationConnections.status, createdAt: communicationConnections.createdAt }).from(communicationConnections).where(eq(communicationConnections.accountId, accountId)).orderBy(desc(communicationConnections.createdAt)).limit(100),
    db().select({ id: communicationMessages.id, direction: communicationMessages.direction, status: communicationMessages.status, threadId: communicationMessages.threadId, taskId: communicationMessages.taskId, createdAt: communicationMessages.createdAt }).from(communicationMessages).where(eq(communicationMessages.accountId, accountId)).orderBy(desc(communicationMessages.createdAt)).limit(50),
    db().select({ id: connectorConnections.id, provider: connectorConnections.provider, displayName: connectorConnections.displayName, scopes: connectorConnections.scopes, restrictions: connectorConnections.restrictions, status: connectorConnections.status, lastVerifiedAt: connectorConnections.lastVerifiedAt }).from(connectorConnections).where(eq(connectorConnections.accountId, accountId)).orderBy(desc(connectorConnections.createdAt)).limit(100),
    db().select({ id: budgets.id, scope: budgets.scope, scopeId: budgets.scopeId, dimension: budgets.dimension, currency: budgets.currency, hardLimit: budgets.hardLimit, softLimit: budgets.softLimit, consumedAmount: budgets.consumedAmount, reservedAmount: budgets.reservedAmount, balanceStatus: budgets.balanceStatus, status: budgets.status, balanceAsOf: budgets.balanceAsOf }).from(budgets).where(eq(budgets.accountId, accountId)).orderBy(desc(budgets.createdAt)).limit(100),
    db().select({ id: policyBundles.id, name: policyBundles.name, layer: policyBundles.layer, version: policyBundles.version, status: policyBundles.status, activatedAt: policyBundles.activatedAt, createdAt: policyBundles.createdAt }).from(policyBundles).where(eq(policyBundles.accountId, accountId)).orderBy(desc(policyBundles.createdAt)).limit(100),
    db().select({ id: runners.id, name: runners.name, assurance: runners.assurance, status: runners.status, softwareDigest: runners.softwareDigest, lastSeenAt: runners.lastSeenAt, certificateExpiresAt: runners.certificateExpiresAt }).from(runners).where(eq(runners.accountId, accountId)).orderBy(desc(runners.createdAt)).limit(100),
    db().select({ id: executionPlacements.id, taskId: executionPlacements.taskId, providerDefinitionId: executionPlacements.providerDefinitionId, status: executionPlacements.status, createdAt: executionPlacements.createdAt, updatedAt: executionPlacements.updatedAt }).from(executionPlacements).where(eq(executionPlacements.accountId, accountId)).orderBy(desc(executionPlacements.createdAt)).limit(100),
    db().select({ id: financialAccounts.id, provider: financialAccounts.provider, displayName: financialAccounts.displayName, kind: financialAccounts.kind, currency: financialAccounts.currency, balance: financialAccounts.balance, balanceAsOf: financialAccounts.balanceAsOf, status: financialAccounts.status }).from(financialAccounts).where(eq(financialAccounts.accountId, accountId)).orderBy(desc(financialAccounts.createdAt)).limit(100),
    db().select({ id: purchaseIntents.id, agentId: purchaseIntents.agentId, taskId: purchaseIntents.taskId, merchantName: purchaseIntents.merchantName, currency: purchaseIntents.currency, requestedAmount: purchaseIntents.requestedAmount, authorizedMaximum: purchaseIntents.authorizedMaximum, status: purchaseIntents.status, createdAt: purchaseIntents.createdAt }).from(purchaseIntents).where(eq(purchaseIntents.accountId, accountId)).orderBy(desc(purchaseIntents.createdAt)).limit(100),
    db().select({ id: runtimeClients.id, displayName: runtimeClients.displayName, selfDeclaredProduct: runtimeClients.selfDeclaredProduct, verifiedProduct: runtimeClients.verifiedProduct, verificationStatus: runtimeClients.verificationStatus, createdAt: runtimeClients.createdAt, revokedAt: runtimeClients.revokedAt }).from(runtimeClients).where(eq(runtimeClients.accountId, accountId)).orderBy(desc(runtimeClients.createdAt)).limit(100),
    db().select({ id: auditRecords.id, sequence: auditRecords.sequence, eventType: auditRecords.eventType, outcome: auditRecords.outcome, agentId: auditRecords.agentId, taskId: auditRecords.taskId, createdAt: auditRecords.createdAt }).from(auditRecords).where(eq(auditRecords.accountId, accountId)).orderBy(desc(auditRecords.sequence)).limit(100),
    db().select({ id: deadLetterEntries.id, taskId: deadLetterEntries.taskId, reasonCode: deadLetterEntries.reasonCode, errorClass: deadLetterEntries.errorClass, createdAt: deadLetterEntries.createdAt }).from(deadLetterEntries).where(eq(deadLetterEntries.accountId, accountId)).orderBy(desc(deadLetterEntries.createdAt)).limit(100),
  ]);
  return { tasks: taskRows, approvals: approvalRows, agents: agentRows, passports: passportRows, computers: computerRows, communicationConnections: communicationRows, communicationMessages: communicationMessageRows, connectorConnections: connectorRows, budgets: budgetRows, policies: policyRows, runners: runnerRows, placements: placementRows, financialAccounts: financialRows, purchases: purchaseRows, runtimes: runtimeRows, activity: activityRows, deadLetters };
}

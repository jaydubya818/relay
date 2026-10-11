import { sql } from 'drizzle-orm';
import { canonicalHash, type ActionIntent, type CapabilityLeaseClaims } from '@/lib/v2/contracts';
import { parseConsumerReadRequest, type ConsumerReadRequest } from './consumer';
import { assertBinding, IntegrationError, type IntegrationAction, type IntegrationBinding } from './contracts';
import { bindExecution } from './execution-binding';
import { captureResultIntegrity } from './result-custody';
import type { ComposioProviderAdapter } from './composio';

/** Structural data port to canonical Relay receiving. This cannot admit Work,
 * issue a lease, debit a budget, or open the public fail-closed gateway. */
type NativeBinding = { accountId: string; ownerId: string; organizationId: string; installationId: string;
  agentId: string; connectionId: string; connectionAuthorityVersion: number; descriptorHash: string; argumentHash: string; targetResource: string };
type Material = { request: ConsumerReadRequest; connection: IntegrationBinding; descriptor: IntegrationAction };
type Context = { binding: NativeBinding; action: ActionIntent; claims: CapabilityLeaseClaims; material: unknown };

export function createNativeConsumerPort(options: { ownerPrincipalId: string; descriptors: readonly IntegrationAction[]; adapter: ComposioProviderAdapter }) {
  const ownerPrincipalId = options.ownerPrincipalId;
  // Qualified installation descriptors are pinned before receiving transactions.
  // The adapter independently fetches and verifies the live descriptor before send.
  const descriptors = structuredClone(options.descriptors);
  const adapter = options.adapter;
  function execution(context: Context) {
    const material = context.material as Material;
    const { capabilityAdmissionDigest: _proof, ...args } = context.action.parameters;
    void _proof;
    const bound = bindExecution(material.request.scope, material.connection, material.request.tool, args,
      { request: material.request, lease: context.claims });
    if (canonicalHash(material.descriptor) !== context.binding.descriptorHash
      || bound.argumentDigest !== context.binding.argumentHash) throw new IntegrationError('NATIVE_MATERIAL_MISMATCH');
    const integrity = captureResultIntegrity({ provider: 'composio', adapterVersion: adapter.version,
      scopeDigest: canonicalHash(material.request.scope), connectionId: material.connection.connectionId,
      authorityVersion: material.connection.authorityVersion, tool: material.request.tool, version: material.request.toolVersion,
      schemaHash: material.request.toolSchemaHash, argumentDigest: bound.argumentDigest, executionBindingDigest: bound.digest,
      actionHash: context.action.canonicalHash, policyDecisionId: context.claims.policyDecisionId, leaseId: context.claims.jti,
      ...(context.claims.approvalDecisionId ? { approvalDecisionId: context.claims.approvalDecisionId } : {}) });
    return { material, args, integrity };
  }
  return {
    connectionQuery(binding: NativeBinding) {
      // Pure, account-scoped SELECT. Receiver executes it under its account fence
      // and PostgreSQL statement deadline; this port never sees a transaction.
      return sql`SELECT binding FROM integration_connections
        WHERE account_id = ${binding.accountId} AND owner_principal_id = ${ownerPrincipalId}
        AND installation_id = ${binding.installationId} AND agent_id = ${binding.agentId}
        AND id = ${binding.connectionId} FOR SHARE`;
    },
    resolve(rows: readonly Record<string, unknown>[], binding: NativeBinding, action: ActionIntent) {
      if (rows.length !== 1) throw new IntegrationError('CONNECTION_UNAVAILABLE');
      const scope = { accountId: binding.accountId, ownerPrincipalId, installationId: binding.installationId, agentId: binding.agentId };
      const connection = assertBinding(scope, rows[0]!.binding as IntegrationBinding);
      const a = action.resource.attributes ?? {};
      const request = parseConsumerReadRequest({ schemaVersion: 'relay.integration-read.v1', scope,
        connectionId: binding.connectionId, toolkit: a.toolkit, tool: a.tool, toolVersion: a.toolVersion,
        toolSchemaHash: a.toolSchemaHash, authorityVersion: binding.connectionAuthorityVersion,
        ownerPolicyRevision: a.ownerPolicyRevision, relayPolicyRevision: a.relayPolicyRevision,
        harnessId: a.harnessId, effect: 'READ', targetResource: binding.targetResource, expiresAt: a.expiresAt, action });
      const descriptor = descriptors.find(d => d.slug === request.tool && d.version === request.toolVersion && d.schemaHash === request.toolSchemaHash);
      const { capabilityAdmissionDigest: _proof, ...args } = action.parameters;
      void _proof;
      if (connection.authorityVersion !== binding.connectionAuthorityVersion || connection.toolkit !== request.toolkit
        || !descriptor || descriptor.effect !== 'READ' || descriptor.toolkit !== request.toolkit
        || canonicalHash(descriptor) !== binding.descriptorHash || canonicalHash(args) !== binding.argumentHash)
        throw new IntegrationError('NATIVE_MATERIAL_MISMATCH');
      return { descriptor, material: { request, connection, descriptor } };
    },
    async execute(context: Context & { signal: AbortSignal }) {
      const { material, args } = execution(context);
      return adapter.executeRead(material.request.scope, material.connection, material.request.tool, args,
        { request: material.request, lease: context.claims }, context.signal);
    },
    validateResult(context: Context, value: unknown) {
      // Capture was performed before dispatch by execute's full bind. Validation
      // uses the immutable identity only and accepts late evidence without issuing
      // authority or treating lease expiry as proof of no effect.
      const material = context.material as Material;
      const { capabilityAdmissionDigest: _proof, ...args } = context.action.parameters;
      void _proof;
      const bindingDigest = canonicalHash({ provider: 'composio', binding: material.connection, request: material.request, lease: context.claims });
      return captureResultIntegrity({ provider: 'composio', adapterVersion: adapter.version,
        scopeDigest: canonicalHash(material.request.scope), connectionId: material.connection.connectionId,
        authorityVersion: material.connection.authorityVersion, tool: material.request.tool, version: material.request.toolVersion,
        schemaHash: material.request.toolSchemaHash, argumentDigest: canonicalHash(args), executionBindingDigest: bindingDigest,
        actionHash: context.action.canonicalHash, policyDecisionId: context.claims.policyDecisionId, leaseId: context.claims.jti,
        ...(context.claims.approvalDecisionId ? { approvalDecisionId: context.claims.approvalDecisionId } : {}) })(value);
    },
  };
}

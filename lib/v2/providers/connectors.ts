import { z } from "zod";
import type { ConnectorAdapter } from "@/lib/v2/connectors";

type Access = { scopes: string[]; accessibleResourceIds: string[]; writableResourceIds: string[] };
type ProviderResult = { state: "SUCCEEDED"; resource: unknown; receipt: Record<string, unknown> } | { state: "PRE_EFFECT_REJECTED"; receipt: Record<string, unknown> } | { state: "EFFECT_UNKNOWN"; receipt: Record<string, unknown> };

export interface GoogleDriveBrokerClient {
  inspect(input: { accountId: string; credentialHandle: string }): Promise<Access>;
  generateFileId(input: { accountId: string; credentialHandle: string }): Promise<string>;
  call(input: { accountId: string; credentialHandle: string; operation: "search" | "read" | "create" | "update"; fileId?: string; parameters: Record<string, unknown> }): Promise<ProviderResult>;
  reconcileCreate(input: { accountId: string; credentialHandle: string; fileId: string }): Promise<{ found: boolean; resource?: unknown; receipt?: Record<string, unknown> }>;
}

export interface LinearBrokerClient {
  inspect(input: { accountId: string; credentialHandle: string }): Promise<Access>;
  call(input: { accountId: string; credentialHandle: string; operation: "search" | "read" | "issueCreate" | "issueUpdate"; relayReference: string; parameters: Record<string, unknown> }): Promise<ProviderResult>;
  reconcileReference(input: { accountId: string; credentialHandle: string; teamId: string; relayReference: string }): Promise<{ found: boolean; resource?: unknown; receipt?: Record<string, unknown> }>;
}

const driveFile = z.object({ id: z.string(), name: z.string(), mimeType: z.string(), parents: z.array(z.string()).default([]), modifiedTime: z.string().optional(), webViewLink: z.string().optional() }).passthrough();
const linearIssue = z.object({ id: z.string(), identifier: z.string().optional(), title: z.string(), team: z.object({ id: z.string() }) }).passthrough();

export function canonicalizeDriveFile(input: unknown) { const file = driveFile.parse(input); return { provider: "GOOGLE_DRIVE" as const, type: "file", externalId: file.id, containerIds: file.parents, name: file.name, mimeType: file.mimeType, modifiedAt: file.modifiedTime, webUrl: file.webViewLink }; }
export function canonicalizeLinearIssue(input: unknown) { const issue = linearIssue.parse(input); return { provider: "LINEAR" as const, type: "issue", externalId: issue.id, identifier: issue.identifier, containerId: issue.team.id, title: issue.title }; }

function operation(capability: string) { return capability.split(".").at(-1)!; }

export class GoogleDriveConnectorAdapter implements ConnectorAdapter {
  readonly provider = "GOOGLE_DRIVE" as const; readonly version = "1.0";
  constructor(private readonly client: GoogleDriveBrokerClient) {}
  async inspectAccess(input: { accountId: string; credentialHandle: string }) { return await this.client.inspect(input); }
  async prepare(input: { accountId: string; credentialHandle: string; capability: string }) { return input.capability.endsWith(".create") ? { providerResourceId: await this.client.generateFileId(input) } : {}; }
  async execute(input: { accountId: string; credentialHandle: string; capability: string; providerResourceId?: string; parameters: Record<string, unknown> }) {
    const verb = operation(input.capability) as "search" | "read" | "create" | "update"; const result = await this.client.call({ accountId: input.accountId, credentialHandle: input.credentialHandle, operation: verb, fileId: input.providerResourceId ?? (input.parameters.resourceId as string | undefined), parameters: input.parameters });
    if (result.state !== "SUCCEEDED") return result; const canonical = Array.isArray(result.resource) ? result.resource.map(canonicalizeDriveFile) : canonicalizeDriveFile(result.resource); return { state: "SUCCEEDED" as const, providerResourceId: input.providerResourceId ?? (Array.isArray(canonical) ? undefined : canonical.externalId), receipt: { ...result.receipt, resource: canonical } };
  }
  async reconcile(input: { accountId: string; credentialHandle: string; providerResourceId?: string }) { if (!input.providerResourceId) return { state: "UNKNOWN" as const }; const result = await this.client.reconcileCreate({ accountId: input.accountId, credentialHandle: input.credentialHandle, fileId: input.providerResourceId }); return result.found && result.resource ? { state: "SUCCEEDED" as const, providerResourceId: input.providerResourceId, receipt: { ...result.receipt, resource: canonicalizeDriveFile(result.resource) } } : { state: "UNKNOWN" as const }; }
}

export class LinearConnectorAdapter implements ConnectorAdapter {
  readonly provider = "LINEAR" as const; readonly version = "1.0";
  constructor(private readonly client: LinearBrokerClient) {}
  async inspectAccess(input: { accountId: string; credentialHandle: string }) { return await this.client.inspect(input); }
  async execute(input: { accountId: string; credentialHandle: string; capability: string; idempotencyKey: string; parameters: Record<string, unknown> }) { const suffix = operation(input.capability); const verb = suffix === "create" ? "issueCreate" : suffix === "update" ? "issueUpdate" : suffix as "search" | "read"; const result = await this.client.call({ accountId: input.accountId, credentialHandle: input.credentialHandle, operation: verb, relayReference: input.idempotencyKey, parameters: input.parameters }); if (result.state !== "SUCCEEDED") return result; const canonical = Array.isArray(result.resource) ? result.resource.map(canonicalizeLinearIssue) : canonicalizeLinearIssue(result.resource); return { state: "SUCCEEDED" as const, providerResourceId: Array.isArray(canonical) ? undefined : canonical.externalId, receipt: { ...result.receipt, resource: canonical, relayReference: input.idempotencyKey } }; }
  async reconcile(input: { accountId: string; credentialHandle: string; idempotencyKey: string; parameters: Record<string, unknown> }) { const result = await this.client.reconcileReference({ accountId: input.accountId, credentialHandle: input.credentialHandle, teamId: String(input.parameters.teamId ?? ""), relayReference: input.idempotencyKey }); return result.found && result.resource ? { state: "SUCCEEDED" as const, providerResourceId: canonicalizeLinearIssue(result.resource).externalId, receipt: { ...result.receipt, resource: canonicalizeLinearIssue(result.resource), relayReference: input.idempotencyKey } } : { state: "UNKNOWN" as const }; }
}

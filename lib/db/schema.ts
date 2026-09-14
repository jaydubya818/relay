import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
};

export const agentStatus = pgEnum("agent_status", ["ACTIVE", "DISABLED"]);
export const grantEffect = pgEnum("grant_effect", ["ALLOW", "DENY"]);
export const riskLevel = pgEnum("risk_level", ["LOW", "MEDIUM", "HIGH"]);
export const memoryScope = pgEnum("memory_scope", ["SHARED", "AGENT_PRIVATE"]);
export const memoryType = pgEnum("memory_type", ["FACT", "PREFERENCE", "PROJECT", "DECISION", "OTHER"]);
export const connectionStatus = pgEnum("connection_status", ["CONNECTED", "DISCONNECTED", "ERROR"]);
export const activityStatus = pgEnum("activity_status", ["SUCCESS", "DENIED", "FAILED", "BLOCKED"]);
export const resourceStatus = pgEnum("resource_status", ["CREATING", "RUNNING", "STOPPED", "EXPIRED", "FAILED", "DESTROYED"]);
export const inboxStatus = pgEnum("inbox_status", ["UNREAD", "CLAIMED", "PROCESSED", "FAILED"]);
export const wakeStatus = pgEnum("wake_status", ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]);
export const sessionStatus = pgEnum("session_status", ["ACTIVE", "EXPIRED", "REVOKED"]);
export const accountRole = pgEnum("account_role", ["OWNER", "MEMBER"]);
export const principalType = pgEnum("principal_type", ["HUMAN", "SERVICE"]);
export const principalStatus = pgEnum("principal_status", ["ACTIVE", "SUSPENDED", "DISABLED"]);
export const membershipRole = pgEnum("membership_role", ["OWNER", "ADMIN", "OPERATOR", "APPROVER", "MEMBER", "AUDITOR"]);
export const membershipStatus = pgEnum("membership_status", ["ACTIVE", "SUSPENDED", "REMOVED"]);
export const stepUpStatus = pgEnum("step_up_status", ["PENDING", "CONSUMED", "EXPIRED", "REVOKED"]);
export const dataClassification = pgEnum("data_classification", ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
export const evidenceSource = pgEnum("evidence_source", ["RELAY_OBSERVED", "PROVIDER_SIGNED", "RUNNER_REPORTED"]);

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: accountRole("role").notNull().default("MEMBER"),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_idx").on(table.email), index("users_account_idx").on(table.accountId)]);

export const principals = pgTable("principals", {
  id: text("id").primaryKey(),
  type: principalType("type").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  status: principalStatus("status").notNull().default("ACTIVE"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex("principals_user_idx").on(table.userId), index("principals_type_status_idx").on(table.type, table.status)]);

export const accountMemberships = pgTable("account_memberships", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull().references(() => principals.id, { onDelete: "cascade" }),
  role: membershipRole("role").notNull(),
  status: membershipStatus("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.accountId, table.principalId] }), index("memberships_principal_status_idx").on(table.principalId, table.status), index("memberships_account_role_idx").on(table.accountId, table.role, table.status)]);

export const serviceClients = pgTable("service_clients", {
  id: text("id").primaryKey(),
  principalId: text("principal_id").notNull().references(() => principals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("service_clients_secret_idx").on(table.secretHash), index("service_clients_principal_idx").on(table.principalId)]);

export const stepUpChallenges = pgTable("step_up_challenges", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull().references(() => principals.id, { onDelete: "cascade" }),
  actionClass: text("action_class").notNull(),
  actionHash: text("action_hash"),
  nonceHash: text("nonce_hash").notNull(),
  authenticationMethod: text("authentication_method").notNull(),
  status: stepUpStatus("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("step_up_nonce_idx").on(table.nonceHash), index("step_up_principal_status_idx").on(table.accountId, table.principalId, table.status, table.expiresAt)]);

export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("user_sessions_token_idx").on(table.tokenHash), index("user_sessions_user_idx").on(table.userId, table.expiresAt)]);

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: agentStatus("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [index("agents_account_idx").on(table.accountId, table.createdAt)]);

export const agentCredentials = pgTable("agent_credentials", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("agent_credentials_secret_idx").on(table.secretHash), index("agent_credentials_agent_idx").on(table.accountId, table.agentId)]);

export const capabilities = pgTable("capabilities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0"),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
  risk: riskLevel("risk").notNull(),
  provider: text("provider"),
  inputSchema: jsonb("input_schema").notNull().default({}),
  outputSchema: jsonb("output_schema").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("ACTIVE"),
}, (table) => [uniqueIndex("capabilities_name_idx").on(table.name), index("capabilities_domain_idx").on(table.domain, table.enabled)]);

export const capabilityGrants = pgTable("capability_grants", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  effect: grantEffect("effect").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("capability_grants_agent_capability_idx").on(table.agentId, table.capability), index("capability_grants_account_agent_idx").on(table.accountId, table.agentId)]);

export const memories = pgTable("memories", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  createdByAgentId: text("created_by_agent_id").notNull().references(() => agents.id),
  scope: memoryScope("scope").notNull(),
  type: memoryType("type").notNull(),
  content: text("content").notNull(),
  source: text("source").notNull().default("agent"),
  ...timestamps,
  forgottenAt: timestamp("forgotten_at", { withTimezone: true, mode: "string" }),
}, (table) => [index("memories_account_active_idx").on(table.accountId, table.forgottenAt, table.createdAt), index("memories_creator_idx").on(table.accountId, table.createdByAgentId)]);

export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  displayName: text("display_name").notNull(),
  status: connectionStatus("status").notNull(),
  externalAccountId: text("external_account_id"),
  scopes: text("scopes").array().notNull().default([]),
  ...timestamps,
}, (table) => [uniqueIndex("connections_account_provider_idx").on(table.accountId, table.provider), index("connections_account_status_idx").on(table.accountId, table.status)]);

export const connectionCredentials = pgTable("connection_credentials", {
  connectionId: text("connection_id").primaryKey().references(() => connections.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const oauthStates = pgTable("oauth_states", {
  id: text("id").primaryKey(),
  stateHash: text("state_hash").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("oauth_states_hash_idx").on(table.stateHash), index("oauth_states_expiry_idx").on(table.provider, table.expiresAt)]);

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  runtime: text("runtime").notNull(),
  credentialId: text("credential_id").notNull().references(() => agentCredentials.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  status: sessionStatus("status").notNull().default("ACTIVE"),
}, (table) => [index("agent_sessions_account_agent_idx").on(table.accountId, table.agentId, table.lastSeenAt)]);

export const activities = pgTable("activities", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  sessionId: text("session_id").notNull(),
  capability: text("capability").notNull(),
  provider: text("provider"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  action: text("action").notNull(),
  status: activityStatus("status").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
}, (table) => [index("activities_account_created_idx").on(table.accountId, table.createdAt), index("activities_agent_created_idx").on(table.accountId, table.agentId, table.createdAt)]);

export const auditChainHeads = pgTable("audit_chain_heads", {
  accountId: text("account_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull().default(0),
  lastHash: text("last_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditRecords = pgTable("audit_records", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  eventType: text("event_type").notNull(),
  actorPrincipalId: text("actor_principal_id"),
  agentId: text("agent_id"),
  runtimeClientId: text("runtime_client_id"),
  taskId: text("task_id"),
  actionIntentId: text("action_intent_id"),
  policyDecisionId: text("policy_decision_id"),
  approvalDecisionId: text("approval_decision_id"),
  leaseId: text("lease_id"),
  provider: text("provider"),
  outcome: text("outcome").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  details: jsonb("details").notNull().default({}),
  previousHash: text("previous_hash"),
  recordHash: text("record_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("audit_account_sequence_idx").on(table.accountId, table.sequence), uniqueIndex("audit_account_hash_idx").on(table.accountId, table.recordHash), index("audit_account_occurred_idx").on(table.accountId, table.occurredAt), index("audit_task_idx").on(table.accountId, table.taskId)]);

export const evidenceArtifacts = pgTable("evidence_artifacts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  taskId: text("task_id"),
  actionIntentId: text("action_intent_id"),
  classification: dataClassification("classification").notNull(),
  source: evidenceSource("source").notNull(),
  mediaType: text("media_type").notNull(),
  objectReference: text("object_reference").notNull(),
  contentHash: text("content_hash").notNull(),
  byteLength: bigint("byte_length", { mode: "number" }).notNull(),
  wrappedKey: text("wrapped_key").notNull(),
  encryptionMetadata: jsonb("encryption_metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "string" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("evidence_account_object_idx").on(table.accountId, table.objectReference), index("evidence_account_created_idx").on(table.accountId, table.createdAt), index("evidence_task_idx").on(table.accountId, table.taskId)]);

export const sandboxes = pgTable("sandboxes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  ownerAgentId: text("owner_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  createdBySession: text("created_by_session").notNull(),
  status: resourceStatus("status").notNull(),
  provider: text("provider").notNull(),
  providerResourceId: text("provider_resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  resourcePolicy: jsonb("resource_policy").notNull().default({}),
}, (table) => [index("sandboxes_account_owner_idx").on(table.accountId, table.ownerAgentId), index("sandboxes_expiry_idx").on(table.status, table.expiresAt)]);

export const sandboxGrants = pgTable("sandbox_grants", {
  sandboxId: text("sandbox_id").notNull().references(() => sandboxes.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.sandboxId, table.agentId] }), index("sandbox_grants_account_agent_idx").on(table.accountId, table.agentId)]);

export const browserSessions = pgTable("browser_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  ownerAgentId: text("owner_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerSessionId: text("provider_session_id"),
  status: resourceStatus("status").notNull(),
  currentUrl: text("current_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  resourcePolicy: jsonb("resource_policy").notNull().default({}),
}, (table) => [index("browser_sessions_account_owner_idx").on(table.accountId, table.ownerAgentId), index("browser_sessions_expiry_idx").on(table.status, table.expiresAt)]);

export const browserSessionGrants = pgTable("browser_session_grants", {
  browserSessionId: text("browser_session_id").notNull().references(() => browserSessions.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.browserSessionId, table.agentId] }), index("browser_session_grants_account_agent_idx").on(table.accountId, table.agentId)]);

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  source: text("source").notNull(),
  providerDeliveryId: text("provider_delivery_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  payloadReference: text("payload_reference"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("events_account_source_delivery_idx").on(table.accountId, table.source, table.providerDeliveryId), index("events_account_created_idx").on(table.accountId, table.createdAt)]);

export const agentInbox = pgTable("agent_inbox", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  status: inboxStatus("status").notNull().default("UNREAD"),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("agent_inbox_agent_event_idx").on(table.agentId, table.eventId), index("agent_inbox_account_agent_status_idx").on(table.accountId, table.agentId, table.status, table.createdAt)]);

export const agentWakeRequests = pgTable("agent_wake_requests", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  preferredRuntime: text("preferred_runtime"),
  status: wakeStatus("status").notNull().default("QUEUED"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("agent_wake_account_status_idx").on(table.accountId, table.status, table.createdAt)]);

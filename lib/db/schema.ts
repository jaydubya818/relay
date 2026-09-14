import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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

export const agentStatus = pgEnum("agent_status", ["DRAFT", "ACTIVE", "DISABLED"]);
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
export const trustTier = pgEnum("trust_tier", ["UNVERIFIED", "REGISTERED", "VERIFIED", "HIGH_ASSURANCE"]);
export const passportStatus = pgEnum("passport_status", ["ACTIVE", "REVOKED", "SUPERSEDED"]);
export const runtimeVerificationStatus = pgEnum("runtime_verification_status", ["SELF_DECLARED", "VERIFIED", "REVOKED"]);
export const policyLayer = pgEnum("policy_layer", ["RELAY_SAFETY", "REGULATORY", "ACCOUNT", "PASSPORT", "RESOURCE", "TASK", "DYNAMIC_RISK"]);
export const policyBundleStatus = pgEnum("policy_bundle_status", ["STAGED", "ACTIVE", "RETIRED", "REVOKED"]);
export const policyOutcome = pgEnum("policy_outcome", ["ALLOW", "DENY", "REQUIRE_APPROVAL", "LIMIT", "ESCALATE"]);
export const approvalStatus = pgEnum("approval_status", ["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED", "SUPERSEDED", "REVOKED"]);
export const approvalDecisionValue = pgEnum("approval_decision_value", ["APPROVE", "DENY"]);
export const notificationStatus = pgEnum("notification_status", ["PENDING", "SENT", "FAILED", "CANCELLED"]);
export const workloadStatus = pgEnum("workload_status", ["BOOTSTRAPPING", "ACTIVE", "REVOKED", "EXPIRED"]);
export const capabilityLeaseStatus = pgEnum("capability_lease_status", ["REQUESTED", "EVALUATED", "ISSUED", "ACTIVE", "EXHAUSTED", "EXPIRED", "REVOKED", "COMPLETED"]);
export const budgetDimension = pgEnum("budget_dimension", ["TOKENS", "MODEL_SPEND", "CONNECTOR_CALLS", "COMPUTE_SECONDS", "COMPUTER_SECONDS", "PURCHASE_AMOUNT"]);
export const budgetScope = pgEnum("budget_scope", ["ACCOUNT", "AGENT", "TASK", "DELEGATION"]);
export const budgetStatus = pgEnum("budget_status", ["ACTIVE", "EXHAUSTED", "DISABLED"]);
export const budgetBalanceStatus = pgEnum("budget_balance_status", ["CURRENT", "STALE", "UNKNOWN"]);
export const budgetReservationStatus = pgEnum("budget_reservation_status", ["RESERVED", "COMMITTED", "RELEASED", "EXPIRED", "UNKNOWN"]);
export const v2TaskState = pgEnum("v2_task_state", ["RECEIVED", "ROUTED", "QUEUED", "STARTING", "RUNNING", "PAUSED", "WAITING_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"]);
export const taskCommandStatus = pgEnum("task_command_status", ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "DEAD_LETTERED"]);
export const executionEffectState = pgEnum("execution_effect_state", ["PRE_EFFECT", "IDEMPOTENT_SAFE", "POSSIBLY_COMMITTED"]);
export const eventSignatureStatus = pgEnum("event_signature_status", ["VERIFIED", "UNVERIFIED", "INVALID"]);
export const routeStatus = pgEnum("route_status", ["ACTIVE", "DISABLED"]);
export const providerDefinitionStatus = pgEnum("provider_definition_status", ["ACTIVE", "DISABLED"]);
export const providerCircuitStatus = pgEnum("provider_circuit_status", ["CLOSED", "OPEN", "HALF_OPEN"]);
export const executionPlacementStatus = pgEnum("execution_placement_status", ["SCHEDULED", "DISPATCHING", "RUNNING", "RECONCILIATION_REQUIRED", "FAILED", "TERMINATED"]);
export const executionAttemptStatus = pgEnum("execution_attempt_status", ["STARTED", "ACCEPTED", "PRE_EFFECT_FAILED", "EFFECT_UNKNOWN", "TERMINATED"]);
export const runnerStatus = pgEnum("runner_status", ["PENDING", "ACTIVE", "QUARANTINED", "REVOKED"]);
export const runnerAssignmentStatus = pgEnum("runner_assignment_status", ["OFFERED", "CLAIMED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "REVOKED"]);

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

export const agentPassports = pgTable("agent_passports", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  trustTier: trustTier("trust_tier").notNull(),
  revocationEpoch: integer("revocation_epoch").notNull().default(0),
  status: passportStatus("status").notNull().default("ACTIVE"),
  payload: jsonb("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "string" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("passports_account_agent_version_idx").on(table.accountId, table.agentId, table.version), index("passports_account_status_idx").on(table.accountId, table.status, table.expiresAt)]);

export const passportImports = pgTable("passport_imports", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  draftAgentId: text("draft_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  sourceIssuer: text("source_issuer").notNull(),
  sourcePassportId: text("source_passport_id").notNull(),
  sourcePayloadHash: text("source_payload_hash").notNull(),
  sourceBundle: jsonb("source_bundle").notNull(),
  signatureVerified: boolean("signature_verified").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("passport_import_account_source_idx").on(table.accountId, table.sourceIssuer, table.sourcePassportId), index("passport_import_agent_idx").on(table.accountId, table.draftAgentId)]);

export const runtimeClients = pgTable("runtime_clients", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  selfDeclaredProduct: text("self_declared_product").notNull(),
  verifiedProduct: text("verified_product"),
  verificationStatus: runtimeVerificationStatus("verification_status").notNull().default("SELF_DECLARED"),
  verificationEvidence: jsonb("verification_evidence"),
  secretHash: text("secret_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("runtime_clients_secret_idx").on(table.secretHash), index("runtime_clients_account_status_idx").on(table.accountId, table.verificationStatus)]);

export const capabilityDefinitions = pgTable("capability_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
  effectClass: text("effect_class").notNull(),
  riskClass: text("risk_class").notNull(),
  resourceType: text("resource_type").notNull(),
  inputSchema: jsonb("input_schema").notNull(),
  outputSchema: jsonb("output_schema").notNull(),
  meteringDimensions: text("metering_dimensions").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  definitionHash: text("definition_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("capability_definition_name_version_idx").on(table.name, table.version), uniqueIndex("capability_definition_hash_idx").on(table.definitionHash), index("capability_definition_domain_idx").on(table.domain, table.enabled)]);

export const policyBundles = pgTable("policy_bundles", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  layer: policyLayer("layer").notNull(),
  version: integer("version").notNull(),
  status: policyBundleStatus("status").notNull().default("STAGED"),
  rules: jsonb("rules").notNull(),
  bundleHash: text("bundle_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  createdByPrincipalId: text("created_by_principal_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
  retiredAt: timestamp("retired_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("policy_bundle_hash_idx").on(table.bundleHash), index("policy_bundle_account_status_idx").on(table.accountId, table.status, table.layer), index("policy_bundle_name_version_idx").on(table.accountId, table.name, table.version)]);

export const policyDecisions = pgTable("policy_decisions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  actionIntentId: text("action_intent_id").notNull(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  outcome: policyOutcome("outcome").notNull(),
  reasonCodes: text("reason_codes").array().notNull(),
  obligations: jsonb("obligations").notNull(),
  capabilityDefinitionHash: text("capability_definition_hash").notNull(),
  policyBundleHashes: text("policy_bundle_hashes").array().notNull(),
  materialFacts: jsonb("material_facts").notNull(),
  evaluationSnapshot: jsonb("evaluation_snapshot").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("policy_decision_account_created_idx").on(table.accountId, table.createdAt), index("policy_decision_action_idx").on(table.accountId, table.actionIntentId), index("policy_decision_agent_outcome_idx").on(table.accountId, table.agentId, table.outcome)]);

export const approvalRequests = pgTable("approval_requests", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  actionIntentId: text("action_intent_id").notNull(),
  actionHash: text("action_hash").notNull(),
  actionSnapshot: jsonb("action_snapshot").notNull(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  runtimeClientId: text("runtime_client_id").notNull(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id"),
  policyDecisionId: text("policy_decision_id").notNull().references(() => policyDecisions.id, { onDelete: "restrict" }),
  approvalClass: text("approval_class").notNull(),
  riskClass: text("risk_class").notNull(),
  effectClass: text("effect_class").notNull(),
  summary: text("summary").notNull(),
  consequence: text("consequence").notNull(),
  displayEvidence: jsonb("display_evidence").notNull(),
  allowedScopes: text("allowed_scopes").array().notNull(),
  assignedPrincipalIds: text("assigned_principal_ids").array().notNull(),
  status: approvalStatus("status").notNull().default("PENDING"),
  approvedScope: jsonb("approved_scope"),
  maxUses: integer("max_uses").notNull().default(1),
  useCount: integer("use_count").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  supersededById: text("superseded_by_id"),
}, (table) => [index("approval_account_status_idx").on(table.accountId, table.status, table.expiresAt), index("approval_task_idx").on(table.accountId, table.taskId, table.status), index("approval_action_idx").on(table.accountId, table.actionIntentId)]);

export const approvalDecisions = pgTable("approval_decisions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  approvalRequestId: text("approval_request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull().references(() => principals.id, { onDelete: "restrict" }),
  decision: approvalDecisionValue("decision").notNull(),
  scope: jsonb("scope"),
  reason: text("reason"),
  decisionHash: text("decision_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  authenticationEvidence: jsonb("authentication_evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("approval_decision_request_idx").on(table.accountId, table.approvalRequestId, table.createdAt), index("approval_decision_principal_idx").on(table.accountId, table.principalId, table.createdAt)]);

export const approvalConsumptions = pgTable("approval_consumptions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  approvalRequestId: text("approval_request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  actionIntentId: text("action_intent_id").notNull(),
  actionHash: text("action_hash").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("approval_consumption_request_action_idx").on(table.approvalRequestId, table.actionIntentId), index("approval_consumption_account_idx").on(table.accountId, table.approvalRequestId)]);

export const approvalNotifications = pgTable("approval_notifications", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  approvalRequestId: text("approval_request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull().references(() => principals.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: notificationStatus("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
}, (table) => [index("approval_notification_delivery_idx").on(table.accountId, table.status, table.createdAt), index("approval_notification_request_idx").on(table.accountId, table.approvalRequestId)]);

export const workloads = pgTable("workloads", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  runtimeClientId: text("runtime_client_id").notNull().references(() => runtimeClients.id, { onDelete: "restrict" }),
  taskId: text("task_id").notNull(),
  runnerId: text("runner_id"),
  providerId: text("provider_id").notNull(),
  assurance: text("assurance").notNull(),
  audience: text("audience").notNull(),
  publicKeyPem: text("public_key_pem").notNull(),
  publicKeyThumbprint: text("public_key_thumbprint").notNull(),
  status: workloadStatus("status").notNull().default("BOOTSTRAPPING"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
}, (table) => [index("workload_account_status_idx").on(table.accountId, table.status, table.expiresAt), index("workload_task_idx").on(table.accountId, table.taskId), index("workload_runtime_idx").on(table.accountId, table.runtimeClientId)]);

export const workloadBootstraps = pgTable("workload_bootstraps", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  workloadId: text("workload_id").notNull().references(() => workloads.id, { onDelete: "cascade" }),
  secretHash: text("secret_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("workload_bootstrap_secret_idx").on(table.secretHash), index("workload_bootstrap_workload_idx").on(table.accountId, table.workloadId)]);

export const agentRevocationEpochs = pgTable("agent_revocation_epochs", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  epoch: integer("epoch").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.accountId, table.agentId] })]);

export const capabilityLeases = pgTable("capability_leases", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  runtimeClientId: text("runtime_client_id").notNull().references(() => runtimeClients.id, { onDelete: "restrict" }),
  workloadId: text("workload_id").notNull().references(() => workloads.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  parentLeaseId: text("parent_lease_id"),
  policyDecisionId: text("policy_decision_id").notNull().references(() => policyDecisions.id, { onDelete: "restrict" }),
  approvalDecisionId: text("approval_decision_id"),
  budgetReservationId: text("budget_reservation_id"),
  status: capabilityLeaseStatus("status").notNull().default("ACTIVE"),
  claims: jsonb("claims").notNull(),
  claimsHash: text("claims_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  callCount: integer("call_count").notNull().default(0),
  delegatedCallCount: integer("delegated_call_count").notNull().default(0),
  maxCalls: integer("max_calls").notNull(),
  revocationEpoch: integer("revocation_epoch").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
  notBefore: timestamp("not_before", { withTimezone: true, mode: "string" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("capability_lease_token_idx").on(table.tokenHash), index("capability_lease_account_status_idx").on(table.accountId, table.status, table.expiresAt), index("capability_lease_task_idx").on(table.accountId, table.taskId), index("capability_lease_parent_idx").on(table.accountId, table.parentLeaseId)]);

export const leaseCallReceipts = pgTable("lease_call_receipts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  leaseId: text("lease_id").notNull().references(() => capabilityLeases.id, { onDelete: "cascade" }),
  callId: text("call_id").notNull(),
  actionHash: text("action_hash").notNull(),
  workloadId: text("workload_id").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("lease_call_idempotency_idx").on(table.leaseId, table.callId), index("lease_call_account_idx").on(table.accountId, table.leaseId)]);

export const runnerEnrollments = pgTable("runner_enrollments", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  createdByPrincipalId: text("created_by_principal_id").notNull().references(() => principals.id, { onDelete: "restrict" }),
  secretHash: text("secret_hash").notNull(),
  runnerName: text("runner_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("runner_enrollment_secret_idx").on(table.secretHash), index("runner_enrollment_account_idx").on(table.accountId, table.expiresAt)]);

export const runners = pgTable("runners", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  publicKeyPem: text("public_key_pem").notNull(),
  publicKeyThumbprint: text("public_key_thumbprint").notNull(),
  softwareDigest: text("software_digest").notNull(),
  configDigest: text("config_digest").notNull(),
  assurance: text("assurance").notNull().default("registered"),
  attestation: jsonb("attestation").notNull().default({}),
  trustEpoch: integer("trust_epoch").notNull().default(1),
  status: runnerStatus("status").notNull().default("PENDING"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
  certificateExpiresAt: timestamp("certificate_expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("runner_account_thumbprint_idx").on(table.accountId, table.publicKeyThumbprint), index("runner_account_status_idx").on(table.accountId, table.status, table.certificateExpiresAt)]);

export const runnerAssignments = pgTable("runner_assignments", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  runnerId: text("runner_id").notNull().references(() => runners.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  workloadId: text("workload_id").notNull().references(() => workloads.id, { onDelete: "cascade" }),
  leaseId: text("lease_id").notNull().references(() => capabilityLeases.id, { onDelete: "restrict" }),
  payload: jsonb("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  fenceToken: bigint("fence_token", { mode: "number" }).notNull().default(1),
  status: runnerAssignmentStatus("status").notNull().default("OFFERED"),
  evidenceSequence: bigint("evidence_sequence", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [index("runner_assignment_poll_idx").on(table.accountId, table.runnerId, table.status, table.createdAt), index("runner_assignment_task_idx").on(table.accountId, table.taskId)]);

export const runnerEvidenceReceipts = pgTable("runner_evidence_receipts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  runnerId: text("runner_id").notNull().references(() => runners.id, { onDelete: "cascade" }),
  assignmentId: text("assignment_id").notNull().references(() => runnerAssignments.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("runner_evidence_sequence_idx").on(table.assignmentId, table.sequence), index("runner_evidence_account_idx").on(table.accountId, table.assignmentId)]);

export const privateGatewayResources = pgTable("private_gateway_resources", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  runnerId: text("runner_id").notNull().references(() => runners.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  allowedMethods: text("allowed_methods").array().notNull(),
  allowedPathPrefixes: text("allowed_path_prefixes").array().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("private_gateway_resource_name_idx").on(table.accountId, table.name), index("private_gateway_runner_idx").on(table.accountId, table.runnerId, table.enabled)]);

export const privateGatewayReceipts = pgTable("private_gateway_receipts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  assignmentId: text("assignment_id").notNull().references(() => runnerAssignments.id, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull().references(() => privateGatewayResources.id, { onDelete: "restrict" }),
  method: text("method").notNull(),
  pathHash: text("path_hash").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("private_gateway_receipt_account_idx").on(table.accountId, table.assignmentId, table.createdAt)]);

export const budgets = pgTable("budgets", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  parentBudgetId: text("parent_budget_id"),
  scope: budgetScope("scope").notNull(),
  scopeId: text("scope_id"),
  dimension: budgetDimension("dimension").notNull(),
  unit: text("unit").notNull(),
  currency: text("currency"),
  hardLimit: numeric("hard_limit", { precision: 30, scale: 9 }).notNull(),
  softLimit: numeric("soft_limit", { precision: 30, scale: 9 }),
  reservedAmount: numeric("reserved_amount", { precision: 30, scale: 9 }).notNull().default("0"),
  consumedAmount: numeric("consumed_amount", { precision: 30, scale: 9 }).notNull().default("0"),
  status: budgetStatus("status").notNull().default("ACTIVE"),
  balanceStatus: budgetBalanceStatus("balance_status").notNull().default("CURRENT"),
  balanceAsOf: timestamp("balance_as_of", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("budget_account_dimension_idx").on(table.accountId, table.dimension, table.status), index("budget_scope_idx").on(table.accountId, table.scope, table.scopeId), index("budget_parent_idx").on(table.accountId, table.parentBudgetId)]);

export const budgetReservations = pgTable("budget_reservations", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  leafBudgetId: text("leaf_budget_id").notNull().references(() => budgets.id, { onDelete: "restrict" }),
  appliedBudgetIds: text("applied_budget_ids").array().notNull(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  actionIntentId: text("action_intent_id").notNull(),
  leaseId: text("lease_id"),
  dimension: budgetDimension("dimension").notNull(),
  unit: text("unit").notNull(),
  currency: text("currency"),
  amount: numeric("amount", { precision: 30, scale: 9 }).notNull(),
  actualAmount: numeric("actual_amount", { precision: 30, scale: 9 }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: budgetReservationStatus("status").notNull().default("RESERVED"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("budget_reservation_idempotency_idx").on(table.accountId, table.idempotencyKey), index("budget_reservation_account_status_idx").on(table.accountId, table.status, table.expiresAt), index("budget_reservation_task_idx").on(table.accountId, table.taskId)]);

export const budgetUsageRecords = pgTable("budget_usage_records", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  reservationId: text("reservation_id").notNull().references(() => budgetReservations.id, { onDelete: "restrict" }),
  leaseId: text("lease_id"),
  dimension: budgetDimension("dimension").notNull(),
  amount: numeric("amount", { precision: 30, scale: 9 }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  source: text("source").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("budget_usage_idempotency_idx").on(table.accountId, table.idempotencyKey), index("budget_usage_reservation_idx").on(table.accountId, table.reservationId)]);

export const budgetEvents = pgTable("budget_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  budgetId: text("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("budget_event_account_idx").on(table.accountId, table.createdAt), index("budget_event_budget_idx").on(table.accountId, table.budgetId)]);

export const eventRoutes = pgTable("event_routes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  status: routeStatus("status").notNull().default("ACTIVE"),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  subjectPrefix: text("subject_prefix"),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
  preferredRuntime: text("preferred_runtime"),
  maxAttempts: integer("max_attempts").notNull().default(5),
  createdByPrincipalId: text("created_by_principal_id").notNull().references(() => principals.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("event_route_name_version_idx").on(table.accountId, table.name, table.version), index("event_route_match_idx").on(table.accountId, table.source, table.eventType, table.status)]);

export const v2Events = pgTable("v2_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  type: text("type").notNull(),
  subject: text("subject"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  dedupeKey: text("dedupe_key").notNull(),
  correlationId: text("correlation_id").notNull(),
  causationId: text("causation_id"),
  schemaVersion: text("schema_version").notNull(),
  classification: text("classification").notNull(),
  signatureStatus: eventSignatureStatus("signature_status").notNull(),
  providerSequence: bigint("provider_sequence", { mode: "bigint" }),
  reordered: boolean("reordered").notNull().default(false),
  data: jsonb("data"),
}, (table) => [uniqueIndex("v2_event_dedupe_idx").on(table.accountId, table.source, table.dedupeKey), index("v2_event_account_received_idx").on(table.accountId, table.receivedAt)]);

export const eventSourceCursors = pgTable("event_source_cursors", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  highestSequence: bigint("highest_sequence", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.accountId, table.source] })]);

export const v2Tasks = pgTable("v2_tasks", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => v2Events.id, { onDelete: "restrict" }),
  routeId: text("route_id").notNull().references(() => eventRoutes.id, { onDelete: "restrict" }),
  logicalKey: text("logical_key").notNull(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
  status: v2TaskState("status").notNull().default("RECEIVED"),
  preferredRuntime: text("preferred_runtime"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull(),
  fenceToken: integer("fence_token").notNull().default(0),
  coordinatorId: text("coordinator_id"),
  coordinatorLeaseUntil: timestamp("coordinator_lease_until", { withTimezone: true, mode: "string" }),
  replayOfTaskId: text("replay_of_task_id"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("v2_task_logical_key_idx").on(table.accountId, table.logicalKey), index("v2_task_event_route_idx").on(table.accountId, table.eventId, table.routeId), index("v2_task_account_status_idx").on(table.accountId, table.status, table.createdAt), index("v2_task_agent_idx").on(table.accountId, table.agentId, table.status)]);

export const taskStateHistory = pgTable("task_state_history", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => v2Tasks.id, { onDelete: "cascade" }),
  fromState: text("from_state"),
  toState: v2TaskState("to_state").notNull(),
  reason: text("reason").notNull(),
  fenceToken: integer("fence_token"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("task_history_account_task_idx").on(table.accountId, table.taskId, table.createdAt)]);

export const taskCommands = pgTable("task_commands", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => v2Tasks.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: taskCommandStatus("status").notNull().default("PENDING"),
  idempotencyKey: text("idempotency_key").notNull(),
  attempt: integer("attempt").notNull().default(0),
  fenceToken: integer("fence_token").notNull().default(0),
  effectState: executionEffectState("effect_state").notNull().default("PRE_EFFECT"),
  payload: jsonb("payload").notNull().default({}),
  runAfter: timestamp("run_after", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  workerId: text("worker_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("task_command_idempotency_idx").on(table.accountId, table.idempotencyKey), index("task_command_claim_idx").on(table.status, table.runAfter, table.createdAt), index("task_command_account_task_idx").on(table.accountId, table.taskId)]);

export const controlOutbox = pgTable("control_outbox", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("control_outbox_idempotency_idx").on(table.accountId, table.idempotencyKey), index("control_outbox_pending_idx").on(table.publishedAt, table.createdAt), index("control_outbox_account_idx").on(table.accountId, table.createdAt)]);

export const deadLetterEntries = pgTable("dead_letter_entries", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => v2Tasks.id, { onDelete: "restrict" }),
  commandId: text("command_id").notNull().references(() => taskCommands.id, { onDelete: "restrict" }),
  reasonCode: text("reason_code").notNull(),
  errorClass: text("error_class"),
  evidence: jsonb("evidence").notNull().default({}),
  replayedByTaskId: text("replayed_by_task_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("dead_letter_command_idx").on(table.accountId, table.commandId), index("dead_letter_account_idx").on(table.accountId, table.createdAt)]);

export const executionProviderDefinitions = pgTable("execution_provider_definitions", {
  id: text("id").primaryKey(),
  providerKey: text("provider_key").notNull(),
  version: text("version").notNull(),
  status: providerDefinitionStatus("status").notNull().default("ACTIVE"),
  manifest: jsonb("manifest").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  signature: text("signature").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("execution_provider_key_version_idx").on(table.providerKey, table.version), uniqueIndex("execution_provider_manifest_hash_idx").on(table.manifestHash), index("execution_provider_active_idx").on(table.status, table.providerKey)]);

export const providerCircuitStates = pgTable("provider_circuit_states", {
  providerDefinitionId: text("provider_definition_id").primaryKey().references(() => executionProviderDefinitions.id, { onDelete: "cascade" }),
  status: providerCircuitStatus("status").notNull().default("CLOSED"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  openedUntil: timestamp("opened_until", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const executionPlacements = pgTable("execution_placements", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => v2Tasks.id, { onDelete: "restrict" }),
  actionIntentId: text("action_intent_id").notNull(),
  leaseId: text("lease_id").notNull().references(() => capabilityLeases.id, { onDelete: "restrict" }),
  providerDefinitionId: text("provider_definition_id").notNull().references(() => executionProviderDefinitions.id, { onDelete: "restrict" }),
  status: executionPlacementStatus("status").notNull().default("SCHEDULED"),
  requirements: jsonb("requirements").notNull(),
  decision: jsonb("decision").notNull(),
  quote: jsonb("quote").notNull(),
  providerSessionId: text("provider_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("execution_placement_action_idx").on(table.accountId, table.taskId, table.actionIntentId), index("execution_placement_account_status_idx").on(table.accountId, table.status, table.createdAt), index("execution_placement_provider_idx").on(table.providerDefinitionId, table.status)]);

export const executionAttempts = pgTable("execution_attempts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  placementId: text("placement_id").notNull().references(() => executionPlacements.id, { onDelete: "cascade" }),
  providerDefinitionId: text("provider_definition_id").notNull().references(() => executionProviderDefinitions.id, { onDelete: "restrict" }),
  attempt: integer("attempt").notNull(),
  status: executionAttemptStatus("status").notNull().default("STARTED"),
  effectState: executionEffectState("effect_state").notNull().default("PRE_EFFECT"),
  idempotencyKey: text("idempotency_key").notNull(),
  providerReceipt: jsonb("provider_receipt"),
  errorClass: text("error_class"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("execution_attempt_number_idx").on(table.accountId, table.placementId, table.attempt), uniqueIndex("execution_attempt_idempotency_idx").on(table.accountId, table.idempotencyKey), index("execution_attempt_account_idx").on(table.accountId, table.startedAt)]);

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

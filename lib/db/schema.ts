import {
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
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_idx").on(table.email), index("users_account_idx").on(table.accountId)]);

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

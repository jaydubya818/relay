CREATE TYPE "public"."activity_status" AS ENUM('SUCCESS', 'DENIED', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('CONNECTED', 'DISCONNECTED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."grant_effect" AS ENUM('ALLOW', 'DENY');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('UNREAD', 'CLAIMED', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."memory_scope" AS ENUM('SHARED', 'AGENT_PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('FACT', 'PREFERENCE', 'PROJECT', 'DECISION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('CREATING', 'RUNNING', 'STOPPED', 'EXPIRED', 'FAILED', 'DESTROYED');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('ACTIVE', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."wake_status" AS ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text,
	"session_id" text NOT NULL,
	"capability" text NOT NULL,
	"provider" text,
	"resource_type" text,
	"resource_id" text,
	"action" text NOT NULL,
	"status" "activity_status" NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" "inbox_status" DEFAULT 'UNREAD' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"runtime" text NOT NULL,
	"credential_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "session_status" DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_wake_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"event_id" text NOT NULL,
	"reason" text NOT NULL,
	"preferred_runtime" text,
	"status" "wake_status" DEFAULT 'QUEUED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "agent_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_session_grants" (
	"browser_session_id" text NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_session_grants_browser_session_id_agent_id_pk" PRIMARY KEY("browser_session_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"owner_agent_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"status" "resource_status" NOT NULL,
	"current_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text DEFAULT '1.0' NOT NULL,
	"domain" text NOT NULL,
	"description" text NOT NULL,
	"risk" "risk_level" NOT NULL,
	"provider" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"capability" text NOT NULL,
	"effect" "grant_effect" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_credentials" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "connection_status" NOT NULL,
	"external_account_id" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"provider_delivery_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload_reference" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_by_agent_id" text NOT NULL,
	"scope" "memory_scope" NOT NULL,
	"type" "memory_type" NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forgotten_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sandbox_grants" (
	"sandbox_id" text NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_grants_sandbox_id_agent_id_pk" PRIMARY KEY("sandbox_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"owner_agent_id" text NOT NULL,
	"created_by_session" text NOT NULL,
	"status" "resource_status" NOT NULL,
	"provider" text NOT NULL,
	"provider_resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resource_policy" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_credential_id_agent_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."agent_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wake_requests" ADD CONSTRAINT "agent_wake_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wake_requests" ADD CONSTRAINT "agent_wake_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wake_requests" ADD CONSTRAINT "agent_wake_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_session_grants" ADD CONSTRAINT "browser_session_grants_browser_session_id_browser_sessions_id_fk" FOREIGN KEY ("browser_session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_session_grants" ADD CONSTRAINT "browser_session_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_session_grants" ADD CONSTRAINT "browser_session_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_credentials" ADD CONSTRAINT "connection_credentials_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_grants" ADD CONSTRAINT "sandbox_grants_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_grants" ADD CONSTRAINT "sandbox_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_grants" ADD CONSTRAINT "sandbox_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_account_created_idx" ON "activities" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_agent_created_idx" ON "activities" USING btree ("account_id","agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_secret_idx" ON "agent_credentials" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "agent_credentials_agent_idx" ON "agent_credentials" USING btree ("account_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_inbox_agent_event_idx" ON "agent_inbox" USING btree ("agent_id","event_id");--> statement-breakpoint
CREATE INDEX "agent_inbox_account_agent_status_idx" ON "agent_inbox" USING btree ("account_id","agent_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_sessions_account_agent_idx" ON "agent_sessions" USING btree ("account_id","agent_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "agent_wake_account_status_idx" ON "agent_wake_requests" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agents_account_idx" ON "agents" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "browser_session_grants_account_agent_idx" ON "browser_session_grants" USING btree ("account_id","agent_id");--> statement-breakpoint
CREATE INDEX "browser_sessions_account_owner_idx" ON "browser_sessions" USING btree ("account_id","owner_agent_id");--> statement-breakpoint
CREATE INDEX "browser_sessions_expiry_idx" ON "browser_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_name_idx" ON "capabilities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "capabilities_domain_idx" ON "capabilities" USING btree ("domain","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_grants_agent_capability_idx" ON "capability_grants" USING btree ("agent_id","capability");--> statement-breakpoint
CREATE INDEX "capability_grants_account_agent_idx" ON "capability_grants" USING btree ("account_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_account_provider_idx" ON "connections" USING btree ("account_id","provider");--> statement-breakpoint
CREATE INDEX "connections_account_status_idx" ON "connections" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "events_account_source_delivery_idx" ON "events" USING btree ("account_id","source","provider_delivery_id");--> statement-breakpoint
CREATE INDEX "events_account_created_idx" ON "events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "memories_account_active_idx" ON "memories" USING btree ("account_id","forgotten_at","created_at");--> statement-breakpoint
CREATE INDEX "memories_creator_idx" ON "memories" USING btree ("account_id","created_by_agent_id");--> statement-breakpoint
CREATE INDEX "sandbox_grants_account_agent_idx" ON "sandbox_grants" USING btree ("account_id","agent_id");--> statement-breakpoint
CREATE INDEX "sandboxes_account_owner_idx" ON "sandboxes" USING btree ("account_id","owner_agent_id");--> statement-breakpoint
CREATE INDEX "sandboxes_expiry_idx" ON "sandboxes" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_idx" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_account_idx" ON "users" USING btree ("account_id");
--> statement-breakpoint
INSERT INTO "capabilities" ("id", "name", "version", "domain", "description", "risk", "provider", "input_schema", "output_schema") VALUES
  ('cap_memory_read', 'memory.read', '1.0', 'MEMORY', 'Read authorized account and private memory.', 'LOW', NULL, '{}', '{}'),
  ('cap_memory_write', 'memory.write', '1.0', 'MEMORY', 'Create durable memory.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_memory_forget', 'memory.forget', '1.0', 'MEMORY', 'Remove memory from active retrieval.', 'HIGH', NULL, '{}', '{}'),
  ('cap_github_repo_read', 'github.repo.read', '1.0', 'GITHUB', 'Read repositories through the account connection.', 'MEDIUM', 'GITHUB', '{}', '{}'),
  ('cap_sandbox_create', 'sandbox.create', '1.0', 'SANDBOX', 'Create an isolated execution sandbox.', 'HIGH', NULL, '{}', '{}'),
  ('cap_sandbox_exec', 'sandbox.exec', '1.0', 'SANDBOX', 'Execute a bounded command in an authorized sandbox.', 'HIGH', NULL, '{}', '{}'),
  ('cap_sandbox_file_read', 'sandbox.file.read', '1.0', 'SANDBOX', 'Read a file from an authorized sandbox.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_sandbox_file_write', 'sandbox.file.write', '1.0', 'SANDBOX', 'Write a file in an authorized sandbox.', 'HIGH', NULL, '{}', '{}'),
  ('cap_sandbox_file_list', 'sandbox.file.list', '1.0', 'SANDBOX', 'List files in an authorized sandbox.', 'LOW', NULL, '{}', '{}'),
  ('cap_sandbox_destroy', 'sandbox.destroy', '1.0', 'SANDBOX', 'Destroy an authorized sandbox.', 'HIGH', NULL, '{}', '{}'),
  ('cap_browser_create', 'browser.create', '1.0', 'BROWSER', 'Create an isolated browser session.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_browser_navigate', 'browser.navigate', '1.0', 'BROWSER', 'Navigate an authorized browser session.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_browser_click', 'browser.click', '1.0', 'BROWSER', 'Click in an authorized browser session.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_browser_type', 'browser.type', '1.0', 'BROWSER', 'Type in an authorized browser session.', 'HIGH', NULL, '{}', '{}'),
  ('cap_browser_extract', 'browser.extract', '1.0', 'BROWSER', 'Extract page content from an authorized browser session.', 'LOW', NULL, '{}', '{}'),
  ('cap_browser_screenshot', 'browser.screenshot', '1.0', 'BROWSER', 'Capture an authorized browser session.', 'LOW', NULL, '{}', '{}'),
  ('cap_browser_close', 'browser.close', '1.0', 'BROWSER', 'Close an authorized browser session.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_agent_inbox_read', 'agent.inbox.read', '1.0', 'AGENT_INBOX', 'Read and acknowledge the Agent inbox.', 'LOW', NULL, '{}', '{}'),
  ('cap_email_read', 'email.read', '1.0', 'EMAIL', 'Search and read authorized email.', 'MEDIUM', 'GOOGLE', '{}', '{}'),
  ('cap_calendar_read', 'calendar.read', '1.0', 'CALENDAR', 'Read events and availability.', 'MEDIUM', 'GOOGLE', '{}', '{}');

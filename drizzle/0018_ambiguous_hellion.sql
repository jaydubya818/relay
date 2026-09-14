CREATE TYPE "public"."connector_operation_status" AS ENUM('PREPARED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EFFECT_UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."connector_provider" AS ENUM('GOOGLE_DRIVE', 'LINEAR');--> statement-breakpoint
CREATE TABLE "connector_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"restrictions" jsonb NOT NULL,
	"credential_handle" text NOT NULL,
	"permission_snapshot" jsonb NOT NULL,
	"permission_snapshot_hash" text NOT NULL,
	"status" "connection_status" DEFAULT 'CONNECTED' NOT NULL,
	"last_verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connector_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"status" "provider_definition_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_oauth_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_handle" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"requested_scopes" text[] NOT NULL,
	"restrictions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connector_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"task_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"capability" text NOT NULL,
	"resource_hash" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"parameters_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_resource_id" text,
	"status" "connector_operation_status" DEFAULT 'PREPARED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"external_id" text NOT NULL,
	"container_external_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permissions_hash" text NOT NULL,
	"last_verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_definition_id_connector_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."connector_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_oauth_flows" ADD CONSTRAINT "connector_oauth_flows_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_oauth_flows" ADD CONSTRAINT "connector_oauth_flows_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_operations" ADD CONSTRAINT "connector_operations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_operations" ADD CONSTRAINT "connector_operations_connection_id_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_resources" ADD CONSTRAINT "connector_resources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_resources" ADD CONSTRAINT "connector_resources_connection_id_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_connection_provider_idx" ON "connector_connections" USING btree ("account_id","provider");--> statement-breakpoint
CREATE INDEX "connector_connection_account_idx" ON "connector_connections" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_definition_version_idx" ON "connector_definitions" USING btree ("provider","version");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_definition_hash_idx" ON "connector_definitions" USING btree ("manifest_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_oauth_state_idx" ON "connector_oauth_flows" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "connector_oauth_account_idx" ON "connector_oauth_flows" USING btree ("account_id","provider","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_operation_idempotency_idx" ON "connector_operations" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "connector_operation_account_idx" ON "connector_operations" USING btree ("account_id","connection_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_resource_external_idx" ON "connector_resources" USING btree ("connection_id","provider_type","external_id");--> statement-breakpoint
CREATE INDEX "connector_resource_account_idx" ON "connector_resources" USING btree ("account_id","connection_id");
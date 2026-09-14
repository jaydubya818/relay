CREATE TYPE "public"."execution_attempt_status" AS ENUM('STARTED', 'ACCEPTED', 'PRE_EFFECT_FAILED', 'EFFECT_UNKNOWN', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."execution_placement_status" AS ENUM('SCHEDULED', 'DISPATCHING', 'RUNNING', 'RECONCILIATION_REQUIRED', 'FAILED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."provider_circuit_status" AS ENUM('CLOSED', 'OPEN', 'HALF_OPEN');--> statement-breakpoint
CREATE TYPE "public"."provider_definition_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "execution_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"placement_id" text NOT NULL,
	"provider_definition_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" "execution_attempt_status" DEFAULT 'STARTED' NOT NULL,
	"effect_state" "execution_effect_state" DEFAULT 'PRE_EFFECT' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_receipt" jsonb,
	"error_class" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_placements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"task_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"provider_definition_id" text NOT NULL,
	"status" "execution_placement_status" DEFAULT 'SCHEDULED' NOT NULL,
	"requirements" jsonb NOT NULL,
	"decision" jsonb NOT NULL,
	"quote" jsonb NOT NULL,
	"provider_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_provider_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"version" text NOT NULL,
	"status" "provider_definition_status" DEFAULT 'ACTIVE' NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_circuit_states" (
	"provider_definition_id" text PRIMARY KEY NOT NULL,
	"status" "provider_circuit_status" DEFAULT 'CLOSED' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"opened_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_placement_id_execution_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."execution_placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_provider_definition_id_execution_provider_definitions_id_fk" FOREIGN KEY ("provider_definition_id") REFERENCES "public"."execution_provider_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_placements" ADD CONSTRAINT "execution_placements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_placements" ADD CONSTRAINT "execution_placements_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_placements" ADD CONSTRAINT "execution_placements_lease_id_capability_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_placements" ADD CONSTRAINT "execution_placements_provider_definition_id_execution_provider_definitions_id_fk" FOREIGN KEY ("provider_definition_id") REFERENCES "public"."execution_provider_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_circuit_states" ADD CONSTRAINT "provider_circuit_states_provider_definition_id_execution_provider_definitions_id_fk" FOREIGN KEY ("provider_definition_id") REFERENCES "public"."execution_provider_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_attempt_number_idx" ON "execution_attempts" USING btree ("account_id","placement_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_attempt_idempotency_idx" ON "execution_attempts" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "execution_attempt_account_idx" ON "execution_attempts" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_placement_action_idx" ON "execution_placements" USING btree ("account_id","task_id","action_intent_id");--> statement-breakpoint
CREATE INDEX "execution_placement_account_status_idx" ON "execution_placements" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "execution_placement_provider_idx" ON "execution_placements" USING btree ("provider_definition_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_provider_key_version_idx" ON "execution_provider_definitions" USING btree ("provider_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_provider_manifest_hash_idx" ON "execution_provider_definitions" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "execution_provider_active_idx" ON "execution_provider_definitions" USING btree ("status","provider_key");
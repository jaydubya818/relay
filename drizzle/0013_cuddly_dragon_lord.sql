CREATE TYPE "public"."event_signature_status" AS ENUM('VERIFIED', 'UNVERIFIED', 'INVALID');--> statement-breakpoint
CREATE TYPE "public"."execution_effect_state" AS ENUM('PRE_EFFECT', 'IDEMPOTENT_SAFE', 'POSSIBLY_COMMITTED');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."task_command_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'DEAD_LETTERED');--> statement-breakpoint
CREATE TYPE "public"."v2_task_state" AS ENUM('RECEIVED', 'ROUTED', 'QUEUED', 'STARTING', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED');--> statement-breakpoint
CREATE TABLE "control_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dead_letter_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"task_id" text NOT NULL,
	"command_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"error_class" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"replayed_by_task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"status" "route_status" DEFAULT 'ACTIVE' NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"subject_prefix" text,
	"agent_id" text NOT NULL,
	"preferred_runtime" text,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_source_cursors" (
	"account_id" text NOT NULL,
	"source" text NOT NULL,
	"highest_sequence" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_source_cursors_account_id_source_pk" PRIMARY KEY("account_id","source")
);
--> statement-breakpoint
CREATE TABLE "task_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"task_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" "task_command_status" DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"fence_token" integer DEFAULT 0 NOT NULL,
	"effect_state" "execution_effect_state" DEFAULT 'PRE_EFFECT' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"worker_id" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_state_history" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"task_id" text NOT NULL,
	"from_state" text,
	"to_state" "v2_task_state" NOT NULL,
	"reason" text NOT NULL,
	"fence_token" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"subject" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"schema_version" text NOT NULL,
	"classification" text NOT NULL,
	"signature_status" "event_signature_status" NOT NULL,
	"provider_sequence" bigint,
	"reordered" boolean DEFAULT false NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "v2_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"event_id" text NOT NULL,
	"route_id" text NOT NULL,
	"logical_key" text NOT NULL,
	"agent_id" text NOT NULL,
	"status" "v2_task_state" DEFAULT 'RECEIVED' NOT NULL,
	"preferred_runtime" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"fence_token" integer DEFAULT 0 NOT NULL,
	"coordinator_id" text,
	"coordinator_lease_until" timestamp with time zone,
	"replay_of_task_id" text,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "control_outbox" ADD CONSTRAINT "control_outbox_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_entries" ADD CONSTRAINT "dead_letter_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_entries" ADD CONSTRAINT "dead_letter_entries_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_entries" ADD CONSTRAINT "dead_letter_entries_command_id_task_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."task_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_routes" ADD CONSTRAINT "event_routes_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_source_cursors" ADD CONSTRAINT "event_source_cursors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_commands" ADD CONSTRAINT "task_commands_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_commands" ADD CONSTRAINT "task_commands_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_state_history" ADD CONSTRAINT "task_state_history_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_state_history" ADD CONSTRAINT "task_state_history_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_events" ADD CONSTRAINT "v2_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_tasks" ADD CONSTRAINT "v2_tasks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_tasks" ADD CONSTRAINT "v2_tasks_event_id_v2_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."v2_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_tasks" ADD CONSTRAINT "v2_tasks_route_id_event_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."event_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_tasks" ADD CONSTRAINT "v2_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "control_outbox_idempotency_idx" ON "control_outbox" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "control_outbox_pending_idx" ON "control_outbox" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE INDEX "control_outbox_account_idx" ON "control_outbox" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letter_command_idx" ON "dead_letter_entries" USING btree ("account_id","command_id");--> statement-breakpoint
CREATE INDEX "dead_letter_account_idx" ON "dead_letter_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_route_name_version_idx" ON "event_routes" USING btree ("account_id","name","version");--> statement-breakpoint
CREATE INDEX "event_route_match_idx" ON "event_routes" USING btree ("account_id","source","event_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "task_command_idempotency_idx" ON "task_commands" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "task_command_claim_idx" ON "task_commands" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX "task_command_account_task_idx" ON "task_commands" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE INDEX "task_history_account_task_idx" ON "task_state_history" USING btree ("account_id","task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_event_dedupe_idx" ON "v2_events" USING btree ("account_id","source","dedupe_key");--> statement-breakpoint
CREATE INDEX "v2_event_account_received_idx" ON "v2_events" USING btree ("account_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_task_logical_key_idx" ON "v2_tasks" USING btree ("account_id","logical_key");--> statement-breakpoint
CREATE INDEX "v2_task_event_route_idx" ON "v2_tasks" USING btree ("account_id","event_id","route_id");--> statement-breakpoint
CREATE INDEX "v2_task_account_status_idx" ON "v2_tasks" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "v2_task_agent_idx" ON "v2_tasks" USING btree ("account_id","agent_id","status");
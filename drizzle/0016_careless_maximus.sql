CREATE TYPE "public"."computer_controller" AS ENUM('AGENT', 'PAUSED', 'HUMAN', 'TERMINATED');--> statement-breakpoint
CREATE TABLE "computer_control_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"control_session_id" text NOT NULL,
	"principal_id" text,
	"event_type" text NOT NULL,
	"fence_token" bigint NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "computer_control_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"placement_id" text NOT NULL,
	"task_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"controller" "computer_controller" DEFAULT 'AGENT' NOT NULL,
	"fence_token" bigint DEFAULT 1 NOT NULL,
	"active_input_count" integer DEFAULT 0 NOT NULL,
	"human_principal_id" text,
	"credential_entry_mode" boolean DEFAULT false NOT NULL,
	"viewer_epoch" integer DEFAULT 1 NOT NULL,
	"last_integrity_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "computer_viewer_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"control_session_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"viewer_epoch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "computer_control_events" ADD CONSTRAINT "computer_control_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_events" ADD CONSTRAINT "computer_control_events_control_session_id_computer_control_sessions_id_fk" FOREIGN KEY ("control_session_id") REFERENCES "public"."computer_control_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_events" ADD CONSTRAINT "computer_control_events_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_sessions" ADD CONSTRAINT "computer_control_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_sessions" ADD CONSTRAINT "computer_control_sessions_placement_id_execution_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."execution_placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_sessions" ADD CONSTRAINT "computer_control_sessions_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_sessions" ADD CONSTRAINT "computer_control_sessions_lease_id_capability_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_control_sessions" ADD CONSTRAINT "computer_control_sessions_human_principal_id_principals_id_fk" FOREIGN KEY ("human_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_viewer_grants" ADD CONSTRAINT "computer_viewer_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_viewer_grants" ADD CONSTRAINT "computer_viewer_grants_control_session_id_computer_control_sessions_id_fk" FOREIGN KEY ("control_session_id") REFERENCES "public"."computer_control_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_viewer_grants" ADD CONSTRAINT "computer_viewer_grants_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "computer_control_event_account_idx" ON "computer_control_events" USING btree ("account_id","control_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_control_placement_idx" ON "computer_control_sessions" USING btree ("account_id","placement_id");--> statement-breakpoint
CREATE INDEX "computer_control_account_state_idx" ON "computer_control_sessions" USING btree ("account_id","controller","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_viewer_token_idx" ON "computer_viewer_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "computer_viewer_account_session_idx" ON "computer_viewer_grants" USING btree ("account_id","control_session_id","expires_at");
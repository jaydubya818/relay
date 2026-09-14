CREATE TYPE "public"."communication_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."communication_message_status" AS ENUM('RECEIVED', 'ROUTED', 'PENDING_APPROVAL', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'EFFECT_UNKNOWN', 'SUPPRESSED');--> statement-breakpoint
CREATE TYPE "public"."communication_provider" AS ENUM('SLACK', 'TELEGRAM');--> statement-breakpoint
CREATE TABLE "communication_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" "communication_provider" NOT NULL,
	"external_account_id" text NOT NULL,
	"owned_identity_id" text NOT NULL,
	"credential_handle" text NOT NULL,
	"webhook_secret_handle" text NOT NULL,
	"status" "connection_status" DEFAULT 'CONNECTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "communication_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"direction" "communication_direction" NOT NULL,
	"provider_message_id" text NOT NULL,
	"provider_event_id" text,
	"sender_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"classification" text NOT NULL,
	"status" "communication_message_status" NOT NULL,
	"task_id" text,
	"action_intent_id" text,
	"lease_id" text,
	"approval_decision_id" text,
	"idempotency_key" text NOT NULL,
	"provider_receipt" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retry_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_thread_id" text DEFAULT '' NOT NULL,
	"recipient_id" text NOT NULL,
	"known_recipient" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_connections" ADD CONSTRAINT "communication_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_connection_id_communication_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."communication_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_thread_id_communication_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."communication_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_threads" ADD CONSTRAINT "communication_threads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_threads" ADD CONSTRAINT "communication_threads_connection_id_communication_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."communication_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communication_connection_external_idx" ON "communication_connections" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE INDEX "communication_connection_account_idx" ON "communication_connections" USING btree ("account_id","provider","status");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_message_provider_idx" ON "communication_messages" USING btree ("connection_id","thread_id","provider_message_id","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_message_event_idx" ON "communication_messages" USING btree ("connection_id","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_message_idempotency_idx" ON "communication_messages" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "communication_message_account_thread_idx" ON "communication_messages" USING btree ("account_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "communication_message_retry_idx" ON "communication_messages" USING btree ("status","retry_after");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_thread_external_idx" ON "communication_threads" USING btree ("connection_id","external_conversation_id","external_thread_id");--> statement-breakpoint
CREATE INDEX "communication_thread_account_idx" ON "communication_threads" USING btree ("account_id","connection_id");
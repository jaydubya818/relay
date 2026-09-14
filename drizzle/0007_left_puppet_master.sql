CREATE TYPE "public"."data_classification" AS ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('RELAY_OBSERVED', 'PROVIDER_SIGNED', 'RUNNER_REPORTED');--> statement-breakpoint
CREATE TABLE "audit_chain_heads" (
	"account_id" text PRIMARY KEY NOT NULL,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"last_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_records" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_principal_id" text,
	"agent_id" text,
	"runtime_client_id" text,
	"task_id" text,
	"action_intent_id" text,
	"policy_decision_id" text,
	"approval_decision_id" text,
	"lease_id" text,
	"provider" text,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_hash" text,
	"record_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"task_id" text,
	"action_intent_id" text,
	"classification" "data_classification" NOT NULL,
	"source" "evidence_source" NOT NULL,
	"media_type" text NOT NULL,
	"object_reference" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"wrapped_key" text NOT NULL,
	"encryption_metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_account_sequence_idx" ON "audit_records" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_account_hash_idx" ON "audit_records" USING btree ("account_id","record_hash");--> statement-breakpoint
CREATE INDEX "audit_account_occurred_idx" ON "audit_records" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_task_idx" ON "audit_records" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_account_object_idx" ON "evidence_artifacts" USING btree ("account_id","object_reference");--> statement-breakpoint
CREATE INDEX "evidence_account_created_idx" ON "evidence_artifacts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_task_idx" ON "evidence_artifacts" USING btree ("account_id","task_id");
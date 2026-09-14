CREATE TYPE "public"."approval_decision_value" AS ENUM('APPROVE', 'DENY');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "approval_consumptions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"action_hash" text NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"decision" "approval_decision_value" NOT NULL,
	"scope" jsonb,
	"reason" text,
	"decision_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"authentication_evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"action_hash" text NOT NULL,
	"action_snapshot" jsonb NOT NULL,
	"agent_id" text NOT NULL,
	"runtime_client_id" text NOT NULL,
	"task_id" text NOT NULL,
	"session_id" text,
	"policy_decision_id" text NOT NULL,
	"approval_class" text NOT NULL,
	"risk_class" text NOT NULL,
	"effect_class" text NOT NULL,
	"summary" text NOT NULL,
	"consequence" text NOT NULL,
	"display_evidence" jsonb NOT NULL,
	"allowed_scopes" text[] NOT NULL,
	"assigned_principal_ids" text[] NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"approved_scope" jsonb,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"superseded_by_id" text
);
--> statement-breakpoint
ALTER TABLE "approval_consumptions" ADD CONSTRAINT "approval_consumptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_consumptions" ADD CONSTRAINT "approval_consumptions_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_notifications" ADD CONSTRAINT "approval_notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_notifications" ADD CONSTRAINT "approval_notifications_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_notifications" ADD CONSTRAINT "approval_notifications_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_decision_id_policy_decisions_id_fk" FOREIGN KEY ("policy_decision_id") REFERENCES "public"."policy_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_consumption_request_action_idx" ON "approval_consumptions" USING btree ("approval_request_id","action_intent_id");--> statement-breakpoint
CREATE INDEX "approval_consumption_account_idx" ON "approval_consumptions" USING btree ("account_id","approval_request_id");--> statement-breakpoint
CREATE INDEX "approval_decision_request_idx" ON "approval_decisions" USING btree ("account_id","approval_request_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_decision_principal_idx" ON "approval_decisions" USING btree ("account_id","principal_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_notification_delivery_idx" ON "approval_notifications" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "approval_notification_request_idx" ON "approval_notifications" USING btree ("account_id","approval_request_id");--> statement-breakpoint
CREATE INDEX "approval_account_status_idx" ON "approval_requests" USING btree ("account_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "approval_task_idx" ON "approval_requests" USING btree ("account_id","task_id","status");--> statement-breakpoint
CREATE INDEX "approval_action_idx" ON "approval_requests" USING btree ("account_id","action_intent_id");
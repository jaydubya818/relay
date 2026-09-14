CREATE TYPE "public"."checkout_permit_status" AS ENUM('ACTIVE', 'COMMIT_READY', 'CONSUMED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."financial_account_status" AS ENUM('ACTIVE', 'DISCONNECTED', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."payment_credential_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."purchase_intent_status" AS ENUM('PENDING_APPROVAL', 'READY_FOR_CHECKOUT', 'HUMAN_CHECKOUT', 'COMMIT_READY', 'REVIEW_REQUIRED', 'COMPLETED', 'EFFECT_UNKNOWN', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"balance" numeric(30, 9),
	"balance_as_of" timestamp with time zone,
	"status" "financial_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"financial_account_id" text NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"amount" numeric(30, 9) NOT NULL,
	"currency" text NOT NULL,
	"merchant" text,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_credential_references" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"credential_handle" text NOT NULL,
	"display_label" text NOT NULL,
	"status" "payment_credential_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_checkout_permits" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"purchase_intent_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"control_session_id" text NOT NULL,
	"fence_token" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"status" "checkout_permit_status" DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"runtime_client_id" text NOT NULL,
	"task_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"action_hash" text NOT NULL,
	"action_snapshot" jsonb NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"currency" text NOT NULL,
	"requested_amount" numeric(30, 9) NOT NULL,
	"tax_shipping_tolerance" numeric(30, 9) DEFAULT '0' NOT NULL,
	"authorized_maximum" numeric(30, 9) NOT NULL,
	"items" jsonb NOT NULL,
	"credential_reference_id" text NOT NULL,
	"budget_reservation_id" text NOT NULL,
	"approval_request_id" text,
	"approval_decision_id" text,
	"control_session_id" text,
	"status" "purchase_intent_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"idempotency_key" text NOT NULL,
	"final_amount" numeric(30, 9),
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"purchase_intent_id" text NOT NULL,
	"provider_reference" text NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"amount" numeric(30, 9) NOT NULL,
	"currency" text NOT NULL,
	"receipt_data" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_financial_account_id_financial_accounts_id_fk" FOREIGN KEY ("financial_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_credential_references" ADD CONSTRAINT "payment_credential_references_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_checkout_permits" ADD CONSTRAINT "purchase_checkout_permits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_checkout_permits" ADD CONSTRAINT "purchase_checkout_permits_purchase_intent_id_purchase_intents_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_checkout_permits" ADD CONSTRAINT "purchase_checkout_permits_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_checkout_permits" ADD CONSTRAINT "purchase_checkout_permits_control_session_id_computer_control_sessions_id_fk" FOREIGN KEY ("control_session_id") REFERENCES "public"."computer_control_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_runtime_client_id_runtime_clients_id_fk" FOREIGN KEY ("runtime_client_id") REFERENCES "public"."runtime_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_credential_reference_id_payment_credential_references_id_fk" FOREIGN KEY ("credential_reference_id") REFERENCES "public"."payment_credential_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_budget_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("budget_reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_approval_decision_id_approval_decisions_id_fk" FOREIGN KEY ("approval_decision_id") REFERENCES "public"."approval_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_control_session_id_computer_control_sessions_id_fk" FOREIGN KEY ("control_session_id") REFERENCES "public"."computer_control_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_intent_id_purchase_intents_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_account_external_idx" ON "financial_accounts" USING btree ("account_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "financial_account_tenant_idx" ON "financial_accounts" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_transaction_external_idx" ON "financial_transactions" USING btree ("financial_account_id","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "financial_transaction_tenant_idx" ON "financial_transactions" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_credential_handle_idx" ON "payment_credential_references" USING btree ("account_id","credential_handle");--> statement-breakpoint
CREATE INDEX "payment_credential_tenant_idx" ON "payment_credential_references" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_checkout_token_idx" ON "purchase_checkout_permits" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_checkout_active_idx" ON "purchase_checkout_permits" USING btree ("account_id","purchase_intent_id");--> statement-breakpoint
CREATE INDEX "purchase_checkout_tenant_idx" ON "purchase_checkout_permits" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_intent_idempotency_idx" ON "purchase_intents" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_intent_action_idx" ON "purchase_intents" USING btree ("account_id","action_intent_id");--> statement-breakpoint
CREATE INDEX "purchase_intent_tenant_status_idx" ON "purchase_intents" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_intent_idx" ON "purchase_receipts" USING btree ("account_id","purchase_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_provider_idx" ON "purchase_receipts" USING btree ("account_id","provider_reference");--> statement-breakpoint
CREATE INDEX "purchase_receipt_tenant_idx" ON "purchase_receipts" USING btree ("account_id","created_at");
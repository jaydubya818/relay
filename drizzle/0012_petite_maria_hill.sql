CREATE TYPE "public"."budget_balance_status" AS ENUM('CURRENT', 'STALE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."budget_dimension" AS ENUM('TOKENS', 'MODEL_SPEND', 'CONNECTOR_CALLS', 'COMPUTE_SECONDS', 'COMPUTER_SECONDS', 'PURCHASE_AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."budget_reservation_status" AS ENUM('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('ACCOUNT', 'AGENT', 'TASK', 'DELEGATION');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('ACTIVE', 'EXHAUSTED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "budget_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"budget_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"leaf_budget_id" text NOT NULL,
	"applied_budget_ids" text[] NOT NULL,
	"agent_id" text NOT NULL,
	"task_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"lease_id" text,
	"dimension" "budget_dimension" NOT NULL,
	"unit" text NOT NULL,
	"currency" text,
	"amount" numeric(30, 9) NOT NULL,
	"actual_amount" numeric(30, 9),
	"idempotency_key" text NOT NULL,
	"status" "budget_reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reconciled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budget_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"lease_id" text,
	"dimension" "budget_dimension" NOT NULL,
	"amount" numeric(30, 9) NOT NULL,
	"idempotency_key" text NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"parent_budget_id" text,
	"scope" "budget_scope" NOT NULL,
	"scope_id" text,
	"dimension" "budget_dimension" NOT NULL,
	"unit" text NOT NULL,
	"currency" text,
	"hard_limit" numeric(30, 9) NOT NULL,
	"soft_limit" numeric(30, 9),
	"reserved_amount" numeric(30, 9) DEFAULT '0' NOT NULL,
	"consumed_amount" numeric(30, 9) DEFAULT '0' NOT NULL,
	"status" "budget_status" DEFAULT 'ACTIVE' NOT NULL,
	"balance_status" "budget_balance_status" DEFAULT 'CURRENT' NOT NULL,
	"balance_as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_definitions" ADD COLUMN "metering_dimensions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_leaf_budget_id_budgets_id_fk" FOREIGN KEY ("leaf_budget_id") REFERENCES "public"."budgets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_usage_records" ADD CONSTRAINT "budget_usage_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_usage_records" ADD CONSTRAINT "budget_usage_records_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_event_account_idx" ON "budget_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_event_budget_idx" ON "budget_events" USING btree ("account_id","budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservation_idempotency_idx" ON "budget_reservations" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "budget_reservation_account_status_idx" ON "budget_reservations" USING btree ("account_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "budget_reservation_task_idx" ON "budget_reservations" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_usage_idempotency_idx" ON "budget_usage_records" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "budget_usage_reservation_idx" ON "budget_usage_records" USING btree ("account_id","reservation_id");--> statement-breakpoint
CREATE INDEX "budget_account_dimension_idx" ON "budgets" USING btree ("account_id","dimension","status");--> statement-breakpoint
CREATE INDEX "budget_scope_idx" ON "budgets" USING btree ("account_id","scope","scope_id");--> statement-breakpoint
CREATE INDEX "budget_parent_idx" ON "budgets" USING btree ("account_id","parent_budget_id");
CREATE TYPE "public"."delegated_authority_status" AS ENUM('AVAILABLE', 'CLAIMED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."delegation_status" AS ENUM('ACTIVE', 'COMPLETED', 'FAILED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "agent_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"parent_delegation_id" text,
	"parent_task_id" text NOT NULL,
	"child_task_id" text NOT NULL,
	"parent_agent_id" text NOT NULL,
	"child_agent_id" text NOT NULL,
	"authorization_lease_id" text NOT NULL,
	"objective" text NOT NULL,
	"depth" integer NOT NULL,
	"status" "delegation_status" DEFAULT 'ACTIVE' NOT NULL,
	"context_manifest_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delegated_authorities" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"delegation_id" text NOT NULL,
	"parent_lease_id" text NOT NULL,
	"child_lease_id" text,
	"capability" jsonb NOT NULL,
	"resource" jsonb NOT NULL,
	"authority_hash" text NOT NULL,
	"max_calls" integer NOT NULL,
	"status" "delegated_authority_status" DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delegation_budget_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"delegation_id" text NOT NULL,
	"parent_budget_id" text NOT NULL,
	"child_budget_id" text NOT NULL,
	"amount" numeric(30, 9) NOT NULL,
	"dimension" "budget_dimension" NOT NULL,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation_context_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"delegation_id" text NOT NULL,
	"source_memory_id" text NOT NULL,
	"classification" "data_classification" NOT NULL,
	"content_snapshot" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"delegation_id" text NOT NULL,
	"child_task_id" text NOT NULL,
	"outcome" text NOT NULL,
	"result" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"evidence_artifact_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_parent_task_id_v2_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_child_task_id_v2_tasks_id_fk" FOREIGN KEY ("child_task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_child_agent_id_agents_id_fk" FOREIGN KEY ("child_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_authorization_lease_id_capability_leases_id_fk" FOREIGN KEY ("authorization_lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_authorities" ADD CONSTRAINT "delegated_authorities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_authorities" ADD CONSTRAINT "delegated_authorities_delegation_id_agent_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."agent_delegations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_authorities" ADD CONSTRAINT "delegated_authorities_parent_lease_id_capability_leases_id_fk" FOREIGN KEY ("parent_lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_authorities" ADD CONSTRAINT "delegated_authorities_child_lease_id_capability_leases_id_fk" FOREIGN KEY ("child_lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_budget_allocations" ADD CONSTRAINT "delegation_budget_allocations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_budget_allocations" ADD CONSTRAINT "delegation_budget_allocations_delegation_id_agent_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."agent_delegations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_budget_allocations" ADD CONSTRAINT "delegation_budget_allocations_parent_budget_id_budgets_id_fk" FOREIGN KEY ("parent_budget_id") REFERENCES "public"."budgets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_budget_allocations" ADD CONSTRAINT "delegation_budget_allocations_child_budget_id_budgets_id_fk" FOREIGN KEY ("child_budget_id") REFERENCES "public"."budgets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_context_entries" ADD CONSTRAINT "delegation_context_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_context_entries" ADD CONSTRAINT "delegation_context_entries_delegation_id_agent_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."agent_delegations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_context_entries" ADD CONSTRAINT "delegation_context_entries_source_memory_id_memories_id_fk" FOREIGN KEY ("source_memory_id") REFERENCES "public"."memories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_results" ADD CONSTRAINT "delegation_results_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_results" ADD CONSTRAINT "delegation_results_delegation_id_agent_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."agent_delegations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_results" ADD CONSTRAINT "delegation_results_child_task_id_v2_tasks_id_fk" FOREIGN KEY ("child_task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_child_task_idx" ON "agent_delegations" USING btree ("account_id","child_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_idempotency_idx" ON "agent_delegations" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_delegation_parent_idx" ON "agent_delegations" USING btree ("account_id","parent_delegation_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_parent_task_idx" ON "agent_delegations" USING btree ("account_id","parent_task_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "delegated_authority_parent_idx" ON "delegated_authorities" USING btree ("account_id","delegation_id","parent_lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegated_authority_child_idx" ON "delegated_authorities" USING btree ("child_lease_id");--> statement-breakpoint
CREATE INDEX "delegated_authority_tenant_idx" ON "delegated_authorities" USING btree ("account_id","delegation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_budget_parent_idx" ON "delegation_budget_allocations" USING btree ("account_id","delegation_id","parent_budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_budget_child_idx" ON "delegation_budget_allocations" USING btree ("account_id","child_budget_id");--> statement-breakpoint
CREATE INDEX "delegation_budget_tenant_idx" ON "delegation_budget_allocations" USING btree ("account_id","delegation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_context_memory_idx" ON "delegation_context_entries" USING btree ("account_id","delegation_id","source_memory_id");--> statement-breakpoint
CREATE INDEX "delegation_context_tenant_idx" ON "delegation_context_entries" USING btree ("account_id","delegation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_result_idx" ON "delegation_results" USING btree ("account_id","delegation_id");--> statement-breakpoint
CREATE INDEX "delegation_result_tenant_idx" ON "delegation_results" USING btree ("account_id","child_task_id");
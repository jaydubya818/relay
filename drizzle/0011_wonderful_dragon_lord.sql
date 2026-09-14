CREATE TYPE "public"."capability_lease_status" AS ENUM('REQUESTED', 'EVALUATED', 'ISSUED', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REVOKED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."workload_status" AS ENUM('BOOTSTRAPPING', 'ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "agent_revocation_epochs" (
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"epoch" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_revocation_epochs_account_id_agent_id_pk" PRIMARY KEY("account_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "capability_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"runtime_client_id" text NOT NULL,
	"workload_id" text NOT NULL,
	"task_id" text NOT NULL,
	"parent_lease_id" text,
	"policy_decision_id" text NOT NULL,
	"approval_decision_id" text,
	"budget_reservation_id" text,
	"status" "capability_lease_status" DEFAULT 'ACTIVE' NOT NULL,
	"claims" jsonb NOT NULL,
	"claims_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"delegated_call_count" integer DEFAULT 0 NOT NULL,
	"max_calls" integer NOT NULL,
	"revocation_epoch" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lease_call_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"call_id" text NOT NULL,
	"action_hash" text NOT NULL,
	"workload_id" text NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workload_bootstraps" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"workload_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workloads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"runtime_client_id" text NOT NULL,
	"task_id" text NOT NULL,
	"runner_id" text,
	"provider_id" text NOT NULL,
	"assurance" text NOT NULL,
	"audience" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"public_key_thumbprint" text NOT NULL,
	"status" "workload_status" DEFAULT 'BOOTSTRAPPING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_revocation_epochs" ADD CONSTRAINT "agent_revocation_epochs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_revocation_epochs" ADD CONSTRAINT "agent_revocation_epochs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_leases" ADD CONSTRAINT "capability_leases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_leases" ADD CONSTRAINT "capability_leases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_leases" ADD CONSTRAINT "capability_leases_runtime_client_id_runtime_clients_id_fk" FOREIGN KEY ("runtime_client_id") REFERENCES "public"."runtime_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_leases" ADD CONSTRAINT "capability_leases_workload_id_workloads_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_leases" ADD CONSTRAINT "capability_leases_policy_decision_id_policy_decisions_id_fk" FOREIGN KEY ("policy_decision_id") REFERENCES "public"."policy_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_call_receipts" ADD CONSTRAINT "lease_call_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_call_receipts" ADD CONSTRAINT "lease_call_receipts_lease_id_capability_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_workload_id_workloads_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workloads" ADD CONSTRAINT "workloads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workloads" ADD CONSTRAINT "workloads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workloads" ADD CONSTRAINT "workloads_runtime_client_id_runtime_clients_id_fk" FOREIGN KEY ("runtime_client_id") REFERENCES "public"."runtime_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_lease_token_idx" ON "capability_leases" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "capability_lease_account_status_idx" ON "capability_leases" USING btree ("account_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "capability_lease_task_idx" ON "capability_leases" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE INDEX "capability_lease_parent_idx" ON "capability_leases" USING btree ("account_id","parent_lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_call_idempotency_idx" ON "lease_call_receipts" USING btree ("lease_id","call_id");--> statement-breakpoint
CREATE INDEX "lease_call_account_idx" ON "lease_call_receipts" USING btree ("account_id","lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workload_bootstrap_secret_idx" ON "workload_bootstraps" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "workload_bootstrap_workload_idx" ON "workload_bootstraps" USING btree ("account_id","workload_id");--> statement-breakpoint
CREATE INDEX "workload_account_status_idx" ON "workloads" USING btree ("account_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "workload_task_idx" ON "workloads" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE INDEX "workload_runtime_idx" ON "workloads" USING btree ("account_id","runtime_client_id");
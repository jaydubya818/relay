CREATE TYPE "public"."runner_assignment_status" AS ENUM('OFFERED', 'CLAIMED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."runner_status" AS ENUM('PENDING', 'ACTIVE', 'QUARANTINED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "private_gateway_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"method" text NOT NULL,
	"path_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_gateway_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"allowed_methods" text[] NOT NULL,
	"allowed_path_prefixes" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"task_id" text NOT NULL,
	"workload_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"fence_token" bigint DEFAULT 1 NOT NULL,
	"status" "runner_assignment_status" DEFAULT 'OFFERED' NOT NULL,
	"evidence_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runner_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"runner_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runner_evidence_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"evidence_hash" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"public_key_thumbprint" text NOT NULL,
	"software_digest" text NOT NULL,
	"config_digest" text NOT NULL,
	"assurance" text DEFAULT 'registered' NOT NULL,
	"attestation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trust_epoch" integer DEFAULT 1 NOT NULL,
	"status" "runner_status" DEFAULT 'PENDING' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"certificate_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "private_gateway_receipts" ADD CONSTRAINT "private_gateway_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_gateway_receipts" ADD CONSTRAINT "private_gateway_receipts_assignment_id_runner_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."runner_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_gateway_receipts" ADD CONSTRAINT "private_gateway_receipts_resource_id_private_gateway_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."private_gateway_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_gateway_resources" ADD CONSTRAINT "private_gateway_resources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_gateway_resources" ADD CONSTRAINT "private_gateway_resources_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_assignments" ADD CONSTRAINT "runner_assignments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_assignments" ADD CONSTRAINT "runner_assignments_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_assignments" ADD CONSTRAINT "runner_assignments_workload_id_workloads_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_assignments" ADD CONSTRAINT "runner_assignments_lease_id_capability_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."capability_leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_enrollments" ADD CONSTRAINT "runner_enrollments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_enrollments" ADD CONSTRAINT "runner_enrollments_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_evidence_receipts" ADD CONSTRAINT "runner_evidence_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_evidence_receipts" ADD CONSTRAINT "runner_evidence_receipts_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_evidence_receipts" ADD CONSTRAINT "runner_evidence_receipts_assignment_id_runner_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."runner_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_gateway_receipt_account_idx" ON "private_gateway_receipts" USING btree ("account_id","assignment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "private_gateway_resource_name_idx" ON "private_gateway_resources" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "private_gateway_runner_idx" ON "private_gateway_resources" USING btree ("account_id","runner_id","enabled");--> statement-breakpoint
CREATE INDEX "runner_assignment_poll_idx" ON "runner_assignments" USING btree ("account_id","runner_id","status","created_at");--> statement-breakpoint
CREATE INDEX "runner_assignment_task_idx" ON "runner_assignments" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_enrollment_secret_idx" ON "runner_enrollments" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "runner_enrollment_account_idx" ON "runner_enrollments" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_evidence_sequence_idx" ON "runner_evidence_receipts" USING btree ("assignment_id","sequence");--> statement-breakpoint
CREATE INDEX "runner_evidence_account_idx" ON "runner_evidence_receipts" USING btree ("account_id","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_account_thumbprint_idx" ON "runners" USING btree ("account_id","public_key_thumbprint");--> statement-breakpoint
CREATE INDEX "runner_account_status_idx" ON "runners" USING btree ("account_id","status","certificate_expires_at");
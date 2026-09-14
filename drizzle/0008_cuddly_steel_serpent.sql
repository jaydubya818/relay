CREATE TYPE "public"."passport_status" AS ENUM('ACTIVE', 'REVOKED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."runtime_verification_status" AS ENUM('SELF_DECLARED', 'VERIFIED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."trust_tier" AS ENUM('UNVERIFIED', 'REGISTERED', 'VERIFIED', 'HIGH_ASSURANCE');--> statement-breakpoint
ALTER TYPE "public"."agent_status" ADD VALUE 'DRAFT' BEFORE 'ACTIVE';--> statement-breakpoint
CREATE TABLE "agent_passports" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"trust_tier" "trust_tier" NOT NULL,
	"revocation_epoch" integer DEFAULT 0 NOT NULL,
	"status" "passport_status" DEFAULT 'ACTIVE' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "passport_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"draft_agent_id" text NOT NULL,
	"source_issuer" text NOT NULL,
	"source_passport_id" text NOT NULL,
	"source_payload_hash" text NOT NULL,
	"source_bundle" jsonb NOT NULL,
	"signature_verified" boolean NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"self_declared_product" text NOT NULL,
	"verified_product" text,
	"verification_status" "runtime_verification_status" DEFAULT 'SELF_DECLARED' NOT NULL,
	"verification_evidence" jsonb,
	"secret_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_passports" ADD CONSTRAINT "agent_passports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_passports" ADD CONSTRAINT "agent_passports_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_imports" ADD CONSTRAINT "passport_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_imports" ADD CONSTRAINT "passport_imports_draft_agent_id_agents_id_fk" FOREIGN KEY ("draft_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_clients" ADD CONSTRAINT "runtime_clients_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passports_account_agent_version_idx" ON "agent_passports" USING btree ("account_id","agent_id","version");--> statement-breakpoint
CREATE INDEX "passports_account_status_idx" ON "agent_passports" USING btree ("account_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passport_import_account_source_idx" ON "passport_imports" USING btree ("account_id","source_issuer","source_passport_id");--> statement-breakpoint
CREATE INDEX "passport_import_agent_idx" ON "passport_imports" USING btree ("account_id","draft_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_clients_secret_idx" ON "runtime_clients" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "runtime_clients_account_status_idx" ON "runtime_clients" USING btree ("account_id","verification_status");
CREATE TYPE "public"."policy_bundle_status" AS ENUM('STAGED', 'ACTIVE', 'RETIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."policy_layer" AS ENUM('RELAY_SAFETY', 'REGULATORY', 'ACCOUNT', 'PASSPORT', 'RESOURCE', 'TASK', 'DYNAMIC_RISK');--> statement-breakpoint
CREATE TYPE "public"."policy_outcome" AS ENUM('ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'LIMIT', 'ESCALATE');--> statement-breakpoint
CREATE TABLE "capability_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"domain" text NOT NULL,
	"description" text NOT NULL,
	"effect_class" text NOT NULL,
	"risk_class" text NOT NULL,
	"resource_type" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"definition_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"name" text NOT NULL,
	"layer" "policy_layer" NOT NULL,
	"version" integer NOT NULL,
	"status" "policy_bundle_status" DEFAULT 'STAGED' NOT NULL,
	"rules" jsonb NOT NULL,
	"bundle_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"created_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"action_intent_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"outcome" "policy_outcome" NOT NULL,
	"reason_codes" text[] NOT NULL,
	"obligations" jsonb NOT NULL,
	"capability_definition_hash" text NOT NULL,
	"policy_bundle_hashes" text[] NOT NULL,
	"material_facts" jsonb NOT NULL,
	"evaluation_snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_bundles" ADD CONSTRAINT "policy_bundles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_definition_name_version_idx" ON "capability_definitions" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_definition_hash_idx" ON "capability_definitions" USING btree ("definition_hash");--> statement-breakpoint
CREATE INDEX "capability_definition_domain_idx" ON "capability_definitions" USING btree ("domain","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_bundle_hash_idx" ON "policy_bundles" USING btree ("bundle_hash");--> statement-breakpoint
CREATE INDEX "policy_bundle_account_status_idx" ON "policy_bundles" USING btree ("account_id","status","layer");--> statement-breakpoint
CREATE INDEX "policy_bundle_name_version_idx" ON "policy_bundles" USING btree ("account_id","name","version");--> statement-breakpoint
CREATE INDEX "policy_decision_account_created_idx" ON "policy_decisions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_decision_action_idx" ON "policy_decisions" USING btree ("account_id","action_intent_id");--> statement-breakpoint
CREATE INDEX "policy_decision_agent_outcome_idx" ON "policy_decisions" USING btree ("account_id","agent_id","outcome");
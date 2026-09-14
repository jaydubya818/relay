CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'ADMIN', 'OPERATOR', 'APPROVER', 'MEMBER', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."principal_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('HUMAN', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."step_up_status" AS ENUM('PENDING', 'CONSUMED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "account_memberships" (
	"account_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_memberships_account_id_principal_id_pk" PRIMARY KEY("account_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "principal_type" NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"status" "principal_status" DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "step_up_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"action_class" text NOT NULL,
	"action_hash" text,
	"nonce_hash" text NOT NULL,
	"authentication_method" text NOT NULL,
	"status" "step_up_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_clients" ADD CONSTRAINT "service_clients_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_challenges" ADD CONSTRAINT "step_up_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_challenges" ADD CONSTRAINT "step_up_challenges_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_principal_status_idx" ON "account_memberships" USING btree ("principal_id","status");--> statement-breakpoint
CREATE INDEX "memberships_account_role_idx" ON "account_memberships" USING btree ("account_id","role","status");--> statement-breakpoint
CREATE UNIQUE INDEX "principals_user_idx" ON "principals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "principals_type_status_idx" ON "principals" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_clients_secret_idx" ON "service_clients" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "service_clients_principal_idx" ON "service_clients" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_up_nonce_idx" ON "step_up_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "step_up_principal_status_idx" ON "step_up_challenges" USING btree ("account_id","principal_id","status","expires_at");--> statement-breakpoint
INSERT INTO "principals" ("id", "type", "user_id", "display_name", "status", "created_at", "updated_at")
SELECT 'prn_' || md5("id"), 'HUMAN', "id", "name", 'ACTIVE', "created_at", "created_at"
FROM "users"
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "account_memberships" ("account_id", "principal_id", "role", "status", "created_at", "updated_at")
SELECT u."account_id", p."id", u."role"::text::"membership_role", 'ACTIVE', u."created_at", u."created_at"
FROM "users" u
INNER JOIN "principals" p ON p."user_id" = u."id"
ON CONFLICT ("account_id", "principal_id") DO NOTHING;

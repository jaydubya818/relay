CREATE TYPE "public"."account_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "account_role" DEFAULT 'MEMBER' NOT NULL;
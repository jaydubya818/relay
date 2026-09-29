ALTER TABLE "accounts" ADD COLUMN "disposable_beta" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "retired_by_user_id" text;--> statement-breakpoint
ALTER TABLE "beta_invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beta_invites" ADD COLUMN "revoked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "beta_invites" ADD CONSTRAINT "beta_invites_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
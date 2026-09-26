CREATE TABLE "beta_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "beta_invites" ADD CONSTRAINT "beta_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beta_invites_token_idx" ON "beta_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "beta_invites_email_idx" ON "beta_invites" USING btree ("email");
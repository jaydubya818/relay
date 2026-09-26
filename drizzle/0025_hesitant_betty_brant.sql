CREATE TABLE "federation_message_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"grantee_account_id" text NOT NULL,
	"grantee_agent_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "federation_message_delegations" ADD CONSTRAINT "federation_message_delegations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_message_delegations" ADD CONSTRAINT "federation_message_delegations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_message_delegations" ADD CONSTRAINT "federation_message_delegations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_message_delegations" ADD CONSTRAINT "federation_message_delegations_grantee_account_id_accounts_id_fk" FOREIGN KEY ("grantee_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_message_delegations" ADD CONSTRAINT "federation_message_delegations_grantee_agent_id_agents_id_fk" FOREIGN KEY ("grantee_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_message_delegations_token_idx" ON "federation_message_delegations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "federation_message_delegations_owner_idx" ON "federation_message_delegations" USING btree ("account_id","agent_id","expires_at");
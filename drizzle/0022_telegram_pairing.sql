CREATE TABLE "telegram_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"owner_principal_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"pairing_challenge_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_pairing_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"owner_principal_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_connection_id_communication_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."communication_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_pairing_challenge_id_telegram_pairing_challenges_id_fk" FOREIGN KEY ("pairing_challenge_id") REFERENCES "public"."telegram_pairing_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pairing_challenges" ADD CONSTRAINT "telegram_pairing_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pairing_challenges" ADD CONSTRAINT "telegram_pairing_challenges_connection_id_communication_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."communication_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pairing_challenges" ADD CONSTRAINT "telegram_pairing_challenges_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pairing_challenges" ADD CONSTRAINT "telegram_pairing_challenges_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_binding_active_connection_idx" ON "telegram_bindings" USING btree ("connection_id") WHERE "telegram_bindings"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_binding_challenge_idx" ON "telegram_bindings" USING btree ("pairing_challenge_id");--> statement-breakpoint
CREATE INDEX "telegram_binding_account_idx" ON "telegram_bindings" USING btree ("account_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_pairing_secret_idx" ON "telegram_pairing_challenges" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "telegram_pairing_connection_idx" ON "telegram_pairing_challenges" USING btree ("account_id","connection_id");
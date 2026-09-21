CREATE TABLE "federation_agents" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"address" text NOT NULL,
	"registration" jsonb NOT NULL,
	"availability" text DEFAULT 'UNKNOWN' NOT NULL,
	"primary_agent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_attempts" (
	"account_id" text NOT NULL,
	"request_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "federation_attempts_request_id_attempt_pk" PRIMARY KEY("request_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "federation_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"grantee_account_id" text NOT NULL,
	"capability" text NOT NULL,
	"resource" text NOT NULL,
	"document" jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_rate_windows" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	CONSTRAINT "federation_rate_windows_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
CREATE TABLE "federation_relationships" (
	"account_id" text NOT NULL,
	"subject" text NOT NULL,
	"trust" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "federation_relationships_account_id_subject_pk" PRIMARY KEY("account_id","subject")
);
--> statement-breakpoint
CREATE TABLE "federation_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"caller_agent_id" text NOT NULL,
	"caller_credential_id" text NOT NULL,
	"target_account_id" text NOT NULL,
	"target_agent_id" text NOT NULL,
	"capability" text NOT NULL,
	"resource" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"submission_hash" text NOT NULL,
	"status" text NOT NULL,
	"inbox_status" text DEFAULT 'UNREAD' NOT NULL,
	"grant_id" text,
	"publication_version" integer,
	"policy_decision_id" text,
	"approval_id" text,
	"encrypted_payload" jsonb,
	"encrypted_result" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_versions" (
	"view_id" text NOT NULL,
	"version" integer NOT NULL,
	"account_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"publisher_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_versions_view_id_version_pk" PRIMARY KEY("view_id","version")
);
--> statement-breakpoint
CREATE TABLE "published_views" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"publisher_agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "federation_agents" ADD CONSTRAINT "federation_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_agents" ADD CONSTRAINT "federation_agents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_attempts" ADD CONSTRAINT "federation_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_attempts" ADD CONSTRAINT "federation_attempts_request_id_federation_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."federation_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_grants" ADD CONSTRAINT "federation_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_grants" ADD CONSTRAINT "federation_grants_grantee_account_id_accounts_id_fk" FOREIGN KEY ("grantee_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_rate_windows" ADD CONSTRAINT "federation_rate_windows_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_relationships" ADD CONSTRAINT "federation_relationships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_requests" ADD CONSTRAINT "federation_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_requests" ADD CONSTRAINT "federation_requests_caller_agent_id_agents_id_fk" FOREIGN KEY ("caller_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_requests" ADD CONSTRAINT "federation_requests_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_requests" ADD CONSTRAINT "federation_requests_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_versions" ADD CONSTRAINT "publication_versions_view_id_published_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."published_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_versions" ADD CONSTRAINT "publication_versions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_views" ADD CONSTRAINT "published_views_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_views" ADD CONSTRAINT "published_views_publisher_agent_id_agents_id_fk" FOREIGN KEY ("publisher_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_address_idx" ON "federation_agents" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_primary_idx" ON "federation_agents" USING btree ("account_id") WHERE "federation_agents"."primary_agent" = true;--> statement-breakpoint
CREATE INDEX "federation_grants_scope_idx" ON "federation_grants" USING btree ("account_id","grantee_account_id","capability","resource");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_request_idempotency_idx" ON "federation_requests" USING btree ("caller_agent_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "federation_request_inbox_idx" ON "federation_requests" USING btree ("target_agent_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "published_views_owner_idx" ON "published_views" USING btree ("account_id","publisher_agent_id");
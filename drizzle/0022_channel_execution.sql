CREATE TABLE "channel_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"task_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"reference" text NOT NULL,
	"binding_hash" text NOT NULL,
	"kind" text NOT NULL,
	"choice" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"message_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "channel_execution_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"environment" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_execution_receipts" (
	"command_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"request_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"response_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_work_links" (
	"task_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"message_id" text NOT NULL,
	"run_id" text,
	"result_id" text,
	"snapshot_encrypted" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_controls" ADD CONSTRAINT "channel_controls_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_controls" ADD CONSTRAINT "channel_controls_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_controls" ADD CONSTRAINT "channel_controls_binding_id_telegram_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_delivery_attempts" ADD CONSTRAINT "channel_delivery_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_delivery_attempts" ADD CONSTRAINT "channel_delivery_attempts_message_id_communication_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."communication_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_work_links" ADD CONSTRAINT "channel_work_links_task_id_v2_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."v2_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_work_links" ADD CONSTRAINT "channel_work_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_work_links" ADD CONSTRAINT "channel_work_links_binding_id_telegram_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_work_links" ADD CONSTRAINT "channel_work_links_message_id_communication_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."communication_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_control_reference_idx" ON "channel_controls" USING btree ("task_id","reference","binding_hash");--> statement-breakpoint
CREATE INDEX "channel_control_account_idx" ON "channel_controls" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_delivery_attempt_idx" ON "channel_delivery_attempts" USING btree ("message_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_work_message_idx" ON "channel_work_links" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "channel_work_account_idx" ON "channel_work_links" USING btree ("account_id","created_at");
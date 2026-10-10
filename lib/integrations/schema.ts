import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { accounts } from "@/lib/db/schema";
import type { IntegrationBinding } from "./contracts";

// Additive provider metadata only. No grants, policy decisions, or credentials.
// Installed explicitly in disposable qualification databases; not by frozen migrations.
export const integrationConnections = pgTable("integration_connections", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  ownerPrincipalId: text("owner_principal_id").notNull(),
  agentId: text("agent_id").notNull(),
  installationId: text("installation_id").notNull(),
  connectedAccountId: text("connected_account_id").notNull(),
  binding: jsonb("binding").$type<IntegrationBinding>().notNull(),
  providerRevocation: text("provider_revocation").notNull().default("NOT_REQUESTED"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [uniqueIndex("integration_provider_identity").on(table.connectedAccountId)]);

export const integrationReceipts = pgTable("integration_receipts", {
  accountId: text("account_id").notNull().references(() => accounts.id),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<{ code: string; connectionId: string }>().notNull(),
}, table => [uniqueIndex("integration_receipt_identity").on(table.accountId, table.key)]);

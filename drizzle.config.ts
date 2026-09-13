import { defineConfig } from "drizzle-kit";

const url = process.env.RELAY_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error("RELAY_DATABASE_URL or DATABASE_URL is required for Drizzle commands.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

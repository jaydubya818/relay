import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";

it("upgrades the canonical schema to Telegram enrollment and permits repeated migration", async () => {
  const adminUrl = process.env.RELAY_TEST_DATABASE_URL ?? "postgresql://127.0.0.1:55432/postgres";
  const databaseName = `relay_telegram_upgrade_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: adminUrl });
  const temporary = await mkdtemp(join(tmpdir(), "relay-telegram-migrations-"));
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: targetUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await client.connect();
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const baseline = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= 20) };
    await mkdir(join(temporary, "meta"));
    await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(baseline));
    for (const entry of baseline.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    const database = drizzle(client);
    await migrate(database, { migrationsFolder: temporary });
    expect((await client.query("SELECT to_regclass('public.telegram_bindings') AS table_name")).rows[0].table_name).toBeNull();
    await client.query("INSERT INTO accounts (id, name) VALUES ('acct_upgrade_sentinel', 'Upgrade sentinel')");
    await migrate(database, { migrationsFolder: "drizzle" });
    await migrate(database, { migrationsFolder: "drizzle" });
    expect((await client.query("SELECT name FROM accounts WHERE id = 'acct_upgrade_sentinel'")).rows).toEqual([{ name: "Upgrade sentinel" }]);
    expect((await client.query("SELECT to_regclass('public.telegram_bindings') AS table_name")).rows[0].table_name).toBe("telegram_bindings");
    expect((await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(journal.entries.length);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const DEFAULT_DIR = process.env.MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

export async function runMigrations(pool: pg.Pool, dir = DEFAULT_DIR) {
  await pool.query(`create table if not exists _migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set(
    (await pool.query(`select name from _migrations`)).rows.map((r) => r.name),
  );
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(path.join(dir, file), "utf8"));
      await client.query(`insert into _migrations (name) values ($1)`, [file]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}

export async function runSeed(pool: pg.Pool) {
  const file = path.resolve(DEFAULT_DIR, "../seed.sql");
  await pool.query(readFileSync(file, "utf8"));
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  const { pool } = await import("./db.js");
  await runMigrations(pool);
  if (process.argv.includes("--seed")) await runSeed(pool);
  await pool.end();
}

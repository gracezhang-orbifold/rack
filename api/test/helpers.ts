import { runMigrations, runSeed } from "../src/migrate.js";
import { pool } from "../src/db.js";
import { env } from "../src/env.js";

// Safety guard: this function drops the entire public schema. Only ever run
// it against a database whose name ends in `_test` — never against the real
// `rack` database (e.g. if DATABASE_URL isn't overridden for tests).
function assertTestDatabase() {
  const dbName = new URL(env.DATABASE_URL).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `refusing to reset database "${dbName}" — resetDb() only runs against a ` +
      `database ending in "_test" (got DATABASE_URL=${env.DATABASE_URL})`);
  }
}

export async function resetDb() {
  assertTestDatabase();
  await pool.query(`drop schema public cascade; create schema public;`);
  await pool.query(`drop table if exists _migrations`);
  await runMigrations(pool);
  await runSeed(pool);
}
export { pool };

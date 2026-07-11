import { runMigrations, runSeed } from "../src/migrate.js";
import { pool } from "../src/db.js";

export async function resetDb() {
  await pool.query(`drop schema public cascade; create schema public;`);
  await pool.query(`drop table if exists _migrations`);
  await runMigrations(pool);
  await runSeed(pool);
}
export { pool };

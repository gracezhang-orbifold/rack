// Vitest global setup (wired via vitest.config.ts `test.setupFiles`).
//
// Runs before any test file is imported, so it lands before src/env.ts
// snapshots process.env — this is what lets us safely default the test
// database without ever touching whatever DATABASE_URL points at in a
// dev/prod shell.
//
// If the caller didn't explicitly point DATABASE_URL at a `_test` database,
// force it to the local Docker Postgres test database. This, combined with
// the `_test`-suffix guard in test/helpers.ts, is the two-layer defense
// against `resetDb()` ever dropping the real `rack` schema.
const dbUrl = process.env.DATABASE_URL;
let needsDefault = !dbUrl;
if (dbUrl) {
  try {
    needsDefault = !new URL(dbUrl).pathname.replace(/^\//, "").endsWith("_test");
  } catch {
    needsDefault = true;
  }
}
if (needsDefault) {
  process.env.DATABASE_URL = "postgresql://rack:rack@localhost:5433/rack_test";
}
process.env.NODE_ENV = "test";

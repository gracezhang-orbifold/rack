import { buildServer } from "./server.js";
import { env } from "./env.js";
import { startReminderCron } from "./reminders.js";
import { runMigrations } from "./migrate.js";
import { pool } from "./db.js";

await runMigrations(pool);
const app = await buildServer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
if (env.CRON_ENABLED) startReminderCron();

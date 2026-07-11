import { buildServer } from "./server.js";
import { env } from "./env.js";
import { startReminderCron } from "./reminders.js";

const app = await buildServer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
if (env.CRON_ENABLED) startReminderCron();

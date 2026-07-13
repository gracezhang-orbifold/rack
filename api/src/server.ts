import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { borrowRoutes } from "./routes/borrow.js";
import { adminRoutes } from "./routes/admin.js";
import { runReminders } from "./reminders.js";

export async function buildServer() {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  app.get("/api/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(catalogRoutes);
  await app.register(borrowRoutes);
  await app.register(adminRoutes);
  if (env.NODE_ENV !== "production") {
    app.post("/api/dev/run-reminders", async () => runReminders());
  }

  const webDist = process.env.WEB_DIST
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}

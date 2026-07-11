import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { env } from "./env.js";

export async function buildServer() {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  app.get("/api/health", async () => ({ ok: true }));
  return app;
}

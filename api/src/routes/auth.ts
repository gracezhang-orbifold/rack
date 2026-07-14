import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from "../auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string; full_name?: string } }>(
    "/api/auth/signup", async (req, reply) => {
      const { email, password, full_name } = req.body ?? {};
      if (!email || !email.includes("@")) return reply.code(400).send({ error: "valid email required" });
      if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
      const hash = await hashPassword(password);
      try {
        const { rows } = await query(
          `insert into profiles (email, full_name, password_hash)
           values (lower($1), $2, $3) returning id, email, role, full_name`,
          [email, full_name ?? null, hash]);
        await createSession(reply, rows[0].id);
        return rows[0];
      } catch (e: any) {
        if (e.code === "23505") return reply.code(409).send({ error: "email already registered" });
        throw e;
      }
    });

  app.post<{ Body: { email?: string; password?: string } }>(
    "/api/auth/login", async (req, reply) => {
      const { email, password } = req.body ?? {};
      const { rows } = await query(
        `select id, email, role, full_name, password_hash from profiles where email = lower($1)`,
        [email ?? ""]);
      if (!rows[0] || !password || !(await verifyPassword(password, rows[0].password_hash)))
        return reply.code(401).send({ error: "invalid email or password" });
      await createSession(reply, rows[0].id);
      const { password_hash, ...user } = rows[0];
      return user;
    });

  app.post("/api/auth/logout", async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser }, async (req) => req.user);

  app.get("/api/me/settings", { preHandler: requireUser }, async (req) => {
    const { rows } = await query(
      `select remind_before_days, overdue_reminder_every_days from profiles where id = $1`,
      [req.user!.id]);
    return rows[0];
  });

  app.patch<{ Body: { remind_before_days?: number; overdue_reminder_every_days?: number } }>(
    "/api/me/settings", { preHandler: requireUser }, async (req, reply) => {
      const { remind_before_days, overdue_reminder_every_days } = req.body ?? {};
      const intIn = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
      if (remind_before_days !== undefined && !intIn(remind_before_days, 14))
        return reply.code(400).send({ error: "remind_before_days must be 0-14" });
      if (overdue_reminder_every_days !== undefined && !intIn(overdue_reminder_every_days, 30))
        return reply.code(400).send({ error: "overdue_reminder_every_days must be 0-30" });
      const { rows } = await query(
        `update profiles set
           remind_before_days = coalesce($2, remind_before_days),
           overdue_reminder_every_days = coalesce($3, overdue_reminder_every_days)
         where id = $1 returning remind_before_days, overdue_reminder_every_days`,
        [req.user!.id, remind_before_days ?? null, overdue_reminder_every_days ?? null]);
      return rows[0];
    });
}

import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { createSession, destroySession, hashPassword, readSessionId, requireUser, verifyPassword } from "../auth.js";
import { pushPublicKey } from "../push.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string; full_name?: string } }>(
    "/api/auth/signup", async (req, reply) => {
      const { email, password, full_name } = req.body ?? {};
      if (!email || !email.includes("@")) return reply.code(400).send({ error: "valid email required" });
      if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
      const hash = await hashPassword(password);
      try {
        // Allowlisted emails become admins; the claim and the insert share
        // one statement so a failed insert (duplicate email) also rolls
        // back the claim.
        const { rows } = await query(
          `with claimed as (
             delete from admin_allowlist where email = lower($1) returning email)
           insert into profiles (email, full_name, password_hash, role)
           values (lower($1), $2, $3,
             case when exists (select 1 from claimed)
               then 'admin'::user_role else 'user'::user_role end)
           returning id, email, role, full_name`,
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

  app.post<{ Body: { current_password?: string; new_password?: string } }>(
    "/api/auth/change-password", { preHandler: requireUser }, async (req, reply) => {
      const { current_password, new_password } = req.body ?? {};
      if (!new_password || new_password.length < 8)
        return reply.code(400).send({ error: "new password must be at least 8 characters" });
      const { rows } = await query(
        `select password_hash from profiles where id = $1`, [req.user!.id]);
      if (!current_password || !(await verifyPassword(current_password, rows[0].password_hash)))
        return reply.code(401).send({ error: "current password is incorrect" });
      await query(`update profiles set password_hash = $2 where id = $1`,
        [req.user!.id, await hashPassword(new_password)]);
      // Sign out every other device; the session making this change stays.
      await query(`delete from sessions where user_id = $1 and id <> $2`,
        [req.user!.id, readSessionId(req)]);
      return { ok: true };
    });

  app.get("/api/me/settings", { preHandler: requireUser }, async (req) => {
    const { rows } = await query(
      `select remind_before_days, overdue_reminder_every_days, reminder_channel from profiles where id = $1`,
      [req.user!.id]);
    // The VAPID public key rides along so the client can both offer the push
    // option (empty key = push not configured server-side) and subscribe.
    return { ...rows[0], vapid_public_key: pushPublicKey() };
  });

  app.patch<{ Body: { remind_before_days?: number; overdue_reminder_every_days?: number;
    reminder_channel?: string } }>(
    "/api/me/settings", { preHandler: requireUser }, async (req, reply) => {
      const { remind_before_days, overdue_reminder_every_days, reminder_channel } = req.body ?? {};
      const intIn = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
      if (remind_before_days !== undefined && !intIn(remind_before_days, 14))
        return reply.code(400).send({ error: "remind_before_days must be 0-14" });
      if (overdue_reminder_every_days !== undefined && !intIn(overdue_reminder_every_days, 30))
        return reply.code(400).send({ error: "overdue_reminder_every_days must be 0-30" });
      if (reminder_channel !== undefined && reminder_channel !== "email" && reminder_channel !== "push")
        return reply.code(400).send({ error: "reminder_channel must be email or push" });
      const { rows } = await query(
        `update profiles set
           remind_before_days = coalesce($2, remind_before_days),
           overdue_reminder_every_days = coalesce($3, overdue_reminder_every_days),
           reminder_channel = coalesce($4, reminder_channel)
         where id = $1 returning remind_before_days, overdue_reminder_every_days, reminder_channel`,
        [req.user!.id, remind_before_days ?? null, overdue_reminder_every_days ?? null,
         reminder_channel ?? null]);
      return { ...rows[0], vapid_public_key: pushPublicKey() };
    });
}

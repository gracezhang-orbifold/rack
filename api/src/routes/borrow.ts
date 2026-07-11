import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";
import { unlockDoor } from "../seam.js";

async function lockForUnit(itemUnitId: string) {
  const { rows } = await query(`
    select l.id, l.seam_device_id from item_units u
    join locks l on l.cabinet_id = u.cabinet_id
    where u.id = $1 and l.is_active and l.seam_device_id is not null
    limit 1`, [itemUnitId]);
  return rows[0] ?? null;
}

async function logEvent(e: { lock_id?: string; session_id: string; user_id: string;
  type: "unlock_requested" | "unlock_succeeded" | "unlock_failed";
  attemptId?: string | null; detail?: object }) {
  await query(`
    insert into device_events (lock_id, borrow_session_id, actor_user_id, event_type, seam_action_attempt_id, detail)
    values ($1, $2, $3, $4, $5, $6)`,
    [e.lock_id ?? null, e.session_id, e.user_id, e.type, e.attemptId ?? null,
     JSON.stringify(e.detail ?? {})]);
}

export async function borrowRoutes(app: FastifyInstance) {
  app.post<{ Body: { item_type_id?: string; days?: number } }>(
    "/api/borrow", { preHandler: requireUser }, async (req, reply) => {
      const { item_type_id, days } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      let session;
      try {
        const { rows } = await query(`select * from borrow_unit($1, $2, $3)`,
          [req.user!.id, item_type_id, days ?? 7]);
        session = rows[0];
      } catch (e: any) {
        const status = /no units available/.test(e.message) ? 409 : 400;
        return reply.code(status).send({ error: e.message.replace(/^.*?: /, "") });
      }
      const lock = await lockForUnit(session.item_unit_id);
      if (!lock) {
        await logEvent({ session_id: session.session_id, user_id: req.user!.id,
          type: "unlock_requested", detail: { skipped: true, reason: "no active Seam lock configured for cabinet" } });
        return { ...session, unlock: "skipped" };
      }
      await logEvent({ lock_id: lock.id, session_id: session.session_id,
        user_id: req.user!.id, type: "unlock_requested" });
      const unlock = await unlockDoor(lock.seam_device_id);
      await logEvent({ lock_id: lock.id, session_id: session.session_id,
        user_id: req.user!.id, type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
        attemptId: unlock.actionAttemptId, detail: unlock.ok ? {} : { error: unlock.error } });
      if (!unlock.ok) {
        await query(`select cancel_borrow_session($1)`, [session.session_id]);
        return reply.code(502).send({ error: "cabinet did not unlock — item not checked out, please retry" });
      }
      return { ...session, unlock: "ok" };
    });

  app.post<{ Body: { session_id?: string } }>(
    "/api/return", { preHandler: requireUser }, async (req, reply) => {
      const { session_id } = req.body ?? {};
      if (!session_id) return reply.code(400).send({ error: "session_id is required" });
      const { rows } = await query(
        `select id, status, item_unit_id, user_id from borrow_sessions where id = $1`, [session_id]);
      const session = rows[0];
      if (!session || (session.user_id !== req.user!.id && req.user!.role !== "admin"))
        return reply.code(404).send({ error: "session not found" });
      if (session.status !== "active")
        return reply.code(409).send({ error: "session is not active" });
      const lock = await lockForUnit(session.item_unit_id);
      if (lock) {
        await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
          type: "unlock_requested", detail: { purpose: "return" } });
        const unlock = await unlockDoor(lock.seam_device_id);
        await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
          type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
          attemptId: unlock.actionAttemptId,
          detail: unlock.ok ? { purpose: "return" } : { purpose: "return", error: unlock.error } });
        if (!unlock.ok)
          return reply.code(502).send({ error: "cabinet did not unlock — item still checked out, please retry" });
      }
      await query(`select mark_returned($1, $2, $3)`,
        [session.id, req.user!.id, req.user!.role === "admin"]);
      return { session_id: session.id, status: "returned" };
    });
}

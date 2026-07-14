import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";

const KINDS = new Set(["waitlist", "notify", "reservation"]);

export async function requestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.post<{ Body: { item_type_id?: string; kind?: string; start_at?: string; days?: number } }>(
    "/api/requests", async (req, reply) => {
      const { item_type_id, kind, start_at, days } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      if (!kind || !KINDS.has(kind)) return reply.code(400).send({ error: "kind must be waitlist, notify, or reservation" });
      if (kind === "reservation") {
        const start = start_at ? new Date(start_at) : null;
        if (!start || isNaN(start.getTime()) || start.getTime() < Date.now())
          return reply.code(400).send({ error: "start_at must be a future date" });
        if (!days || days < 1 || days > 90)
          return reply.code(400).send({ error: "days must be between 1 and 90" });
      } else if (start_at !== undefined || days !== undefined) {
        return reply.code(400).send({ error: `start_at and days only apply to reservations` });
      }
      try {
        const { rows } = await query(
          `insert into item_requests (user_id, item_type_id, kind, start_at, days)
           values ($1, $2, $3, $4, $5)
           returning id, item_type_id, kind, start_at, days, created_at`,
          [req.user!.id, item_type_id, kind, start_at ?? null, days ?? null]);
        return rows[0];
      } catch (e: any) {
        if (e.code === "23505")
          return reply.code(409).send({ error: `you already have an active ${kind} request for this item` });
        if (e.code === "23503")
          return reply.code(404).send({ error: "item not found" });
        throw e;
      }
    });

  app.get("/api/requests", async (req) => {
    const { rows } = await query(
      `select r.id, r.item_type_id, t.name as item_name, t.category, r.kind,
              r.start_at, r.days, r.created_at,
              case when r.kind = 'waitlist' then (
                select count(*) from item_requests w
                where w.item_type_id = r.item_type_id and w.kind = 'waitlist'
                  and w.status = 'active' and w.created_at <= r.created_at)::int
              end as position
       from item_requests r
       join item_types t on t.id = r.item_type_id
       where r.user_id = $1 and r.status = 'active'
       order by r.created_at desc`, [req.user!.id]);
    return rows;
  });

  app.delete<{ Params: { id: string } }>("/api/requests/:id", async (req, reply) => {
    const { rows } = await query(
      `update item_requests set status = 'cancelled'
       where id = $1 and user_id = $2 and status = 'active'
       returning id`, [req.params.id, req.user!.id]);
    if (!rows[0]) return reply.code(404).send({ error: "request not found" });
    return { id: rows[0].id, status: "cancelled" };
  });
}

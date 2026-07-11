import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireAdmin } from "../auth.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/borrows", async () => {
    const active = await query(`select * from active_borrows order by is_overdue desc, due_at`);
    const history = await query(`
      select s.id as session_id, p.email, t.name as item_name, s.status,
             s.checked_out_at, s.returned_at
      from borrow_sessions s
      join profiles p on p.id = s.user_id
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      where s.status <> 'active' order by s.checked_out_at desc limit 100`);
    return { active: active.rows, history: history.rows };
  });

  app.post<{ Body: { session_id?: string } }>("/api/admin/return", async (req, reply) => {
    const { session_id } = req.body ?? {};
    if (!session_id) return reply.code(400).send({ error: "session_id is required" });
    try {
      await query(`select mark_returned($1, $2, true)`, [session_id, req.user!.id]);
    } catch (e: any) {
      if (/not found/.test(e.message)) return reply.code(404).send({ error: "session not found" });
      return reply.code(409).send({ error: "session is not active" });
    }
    return { session_id, status: "returned" };
  });

  app.get("/api/admin/item-types", async () => {
    const { rows } = await query(`
      select t.id, t.name, t.category, t.notes,
        coalesce(json_agg(json_build_object(
          'id', u.id, 'asset_id', u.asset_id, 'status', u.status,
          'owner', u.owner, 'notes', u.notes) order by u.created_at)
          filter (where u.id is not null), '[]') as units
      from item_types t left join item_units u on u.item_type_id = t.id
      group by t.id order by t.category, t.name`);
    return rows;
  });

  app.post<{ Body: { name?: string; category?: string; notes?: string } }>(
    "/api/admin/item-types", async (req, reply) => {
      const { name, category, notes } = req.body ?? {};
      if (!name || !category) return reply.code(400).send({ error: "name and category are required" });
      const { rows } = await query(
        `insert into item_types (name, category, notes) values ($1, $2, $3) returning *`,
        [name, category, notes ?? null]);
      return rows[0];
    });

  app.patch<{ Params: { id: string }; Body: { name?: string; category?: string; notes?: string } }>(
    "/api/admin/item-types/:id", async (req, reply) => {
      const { rows } = await query(`
        update item_types set
          name = coalesce($2, name), category = coalesce($3, category),
          notes = coalesce($4, notes)
        where id = $1 returning *`,
        [req.params.id, req.body?.name ?? null, req.body?.category ?? null, req.body?.notes ?? null]);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      return rows[0];
    });

  app.post<{ Body: { item_type_id?: string; count?: number; asset_id?: string; notes?: string } }>(
    "/api/admin/item-units", async (req, reply) => {
      const { item_type_id, count = 1, asset_id, notes } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      if (count < 1 || count > 100) return reply.code(400).send({ error: "count must be 1-100" });
      if (asset_id && count > 1) return reply.code(400).send({ error: "asset_id only valid with count=1" });
      const cabinet = await query(`select id from cabinets order by created_at limit 1`);
      const { rows } = await query(`
        insert into item_units (item_type_id, cabinet_id, asset_id, notes)
        select $1, $2, $3, $4 from generate_series(1, $5) returning id`,
        [item_type_id, cabinet.rows[0]?.id ?? null, asset_id ?? null, notes ?? null, count]);
      return { created: rows.length };
    });

  app.patch<{ Params: { id: string };
    Body: { status?: string; asset_id?: string; owner?: string; notes?: string } }>(
    "/api/admin/item-units/:id", async (req, reply) => {
      const { status, asset_id, owner, notes } = req.body ?? {};
      if (status === "available") {
        const active = await query(
          `select 1 from borrow_sessions where item_unit_id = $1 and status = 'active'`,
          [req.params.id]);
        if (active.rows[0])
          return reply.code(409).send({ error: "unit has an active borrow session — return it instead" });
      }
      const { rows } = await query(`
        update item_units set
          status = coalesce($2::unit_status, status), asset_id = coalesce($3, asset_id),
          owner = coalesce($4, owner), notes = coalesce($5, notes)
        where id = $1 returning *`,
        [req.params.id, status ?? null, asset_id ?? null, owner ?? null, notes ?? null]);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      return rows[0];
    });
}

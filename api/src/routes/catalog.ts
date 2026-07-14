import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/api/availability", { preHandler: requireUser }, async () => {
    const { rows } = await query(`
      select a.item_type_id, a.name, a.category, a.notes,
             a.total_units::int, a.available_units::int, a.in_use_units::int,
             a.needs_repair_units::int, a.missing_units::int, a.asset_ids,
             case when t.accessory_type_id is null then null else json_build_object(
               'item_type_id', acc.item_type_id, 'name', acc.name,
               'available_units', acc.available_units::int) end as accessory
      from item_availability a
      join item_types t on t.id = a.item_type_id
      left join item_availability acc on acc.item_type_id = t.accessory_type_id
      order by a.category, a.name`);
    return rows;
  });

  // Resolve a printed QR label (asset id) to its unit + item type.
  app.get<{ Params: { assetId: string } }>(
    "/api/units/by-asset/:assetId", { preHandler: requireUser }, async (req, reply) => {
      const { rows } = await query(`
        select u.id as unit_id, u.asset_id, u.status, t.id as item_type_id, t.name, t.category,
               case when t.accessory_type_id is null then null else json_build_object(
                 'item_type_id', acc.item_type_id, 'name', acc.name,
                 'available_units', acc.available_units::int) end as accessory
        from item_units u
        join item_types t on t.id = u.item_type_id
        left join item_availability acc on acc.item_type_id = t.accessory_type_id
        where u.asset_id = $1 and u.status <> 'retired'`, [req.params.assetId]);
      if (!rows[0]) return reply.code(404).send({ error: "no item with this asset id" });
      return rows[0];
    });

  app.get("/api/my-borrows", { preHandler: requireUser }, async (req) => {
    const active = await query(`
      select session_id, item_name, category, asset_id, checked_out_at, due_at, is_overdue,
             unit_confirmed, return_questions
      from active_borrows where user_id = $1 order by due_at`, [req.user!.id]);
    const history = await query(`
      select s.id as session_id, t.name as item_name, u.asset_id, s.status,
             s.checked_out_at, s.returned_at
      from borrow_sessions s
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      where s.user_id = $1 and s.status <> 'active'
      order by s.checked_out_at desc limit 50`, [req.user!.id]);
    return { active: active.rows, history: history.rows };
  });
}

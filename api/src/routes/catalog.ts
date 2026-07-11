import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/api/availability", { preHandler: requireUser }, async () => {
    const { rows } = await query(`
      select item_type_id, name, category, notes,
             total_units::int, available_units::int, in_use_units::int,
             needs_repair_units::int, missing_units::int
      from item_availability order by category, name`);
    return rows;
  });

  app.get("/api/my-borrows", { preHandler: requireUser }, async (req) => {
    const active = await query(`
      select session_id, item_name, category, asset_id, checked_out_at, due_at, is_overdue
      from active_borrows where user_id = $1 order by due_at`, [req.user!.id]);
    const history = await query(`
      select s.id as session_id, t.name as item_name, s.status, s.checked_out_at, s.returned_at
      from borrow_sessions s
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      where s.user_id = $1 and s.status <> 'active'
      order by s.checked_out_at desc limit 50`, [req.user!.id]);
    return { active: active.rows, history: history.rows };
  });
}

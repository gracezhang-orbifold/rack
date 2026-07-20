import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser, requireAdmin } from "../auth.js";
import { emailAdmins } from "../notify.js";
import { escapeHtml as esc } from "../mailer.js";

export async function serviceRoutes(app: FastifyInstance) {
  // Raise: any user reports a problem with a labeled unit.
  app.post<{ Body: { asset_id?: string; description?: string } }>(
    "/api/service-requests", { preHandler: requireUser }, async (req, reply) => {
      const { asset_id, description } = req.body ?? {};
      if (!asset_id) return reply.code(400).send({ error: "asset_id is required" });
      if (!description?.trim() || description.length > 500)
        return reply.code(400).send({ error: "please describe the problem (at most 500 characters)" });
      const { rows: [unit] } = await query(`
        select u.id, u.asset_id, t.name from item_units u
        join item_types t on t.id = u.item_type_id
        where u.asset_id = $1 and u.status <> 'retired'`, [asset_id]);
      if (!unit) return reply.code(404).send({ error: "no item with this asset id" });
      const { rows: [sr] } = await query(`
        insert into service_requests (item_unit_id, user_id, description)
        values ($1, $2, $3) returning id, status, created_at`, [unit.id, req.user!.id, description.trim()]);
      await emailAdmins(`Rack: service request for ${unit.name} (${unit.asset_id})`,
        `<p>${esc(req.user!.full_name ?? req.user!.email)} reported a problem with <strong>${esc(unit.name)} (${esc(unit.asset_id)})</strong>:</p>
<blockquote>${esc(description.trim())}</blockquote><p>Review it under Admin → View Request.</p><p>— Rack</p>`);
      return { id: sr.id, status: sr.status, created_at: sr.created_at, asset_id: unit.asset_id, item_name: unit.name };
    });

  // Mine: the caller's own service requests, newest first.
  app.get("/api/service-requests", { preHandler: requireUser }, async (req) => {
    const { rows } = await query(`
      select sr.id, sr.description, sr.status, sr.created_at, sr.resolved_at,
             u.asset_id, t.name as item_name
      from service_requests sr
      join item_units u on u.id = sr.item_unit_id
      join item_types t on t.id = u.item_type_id
      where sr.user_id = $1 order by sr.created_at desc limit 50`, [req.user!.id]);
    return rows;
  });

  // Admin: open queue + resolve.
  app.get("/api/admin/service-requests", { preHandler: requireAdmin }, async () => {
    const { rows } = await query(`
      select sr.id, sr.description, sr.status, sr.created_at,
             u.asset_id, u.id as item_unit_id, u.status as unit_status,
             t.name as item_name, p.email, p.full_name
      from service_requests sr
      join item_units u on u.id = sr.item_unit_id
      join item_types t on t.id = u.item_type_id
      join profiles p on p.id = sr.user_id
      where sr.status = 'open' order by sr.created_at desc`);
    return rows;
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/service-requests/:id/resolve", { preHandler: requireAdmin }, async (req, reply) => {
      let rows;
      try {
        ({ rows } = await query(`
          update service_requests set status = 'resolved', resolved_by = $2, resolved_at = now()
          where id = $1 and status = 'open' returning id`, [req.params.id, req.user!.id]));
      } catch (e: any) {
        if (e?.code === "22P02") return reply.code(404).send({ error: "not found" });
        throw e;
      }
      if (rows[0]) return { id: rows[0].id, status: "resolved" };
      const exists = await query(`select 1 from service_requests where id = $1`, [req.params.id]);
      if (!exists.rows[0]) return reply.code(404).send({ error: "not found" });
      return reply.code(409).send({ error: "already resolved" });
    });
}

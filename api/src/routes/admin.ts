import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireAdmin } from "../auth.js";
import { processItemAvailability } from "../requests.js";
import { validateQuestions, renderAnswers, type ReturnQuestion, type ReturnAnswers } from "../questionnaire.js";

// Accessory-kit link validation: the id must name an existing item type and
// differ from the type being edited. Returns an error message or null.
async function accessoryLinkError(value: unknown, selfId: string | null): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return "accessory_type_id must be an item type id or null";
  if (selfId !== null && value === selfId) return "an item type cannot be its own accessory kit";
  try {
    const { rows } = await query(`select 1 from item_types where id = $1`, [value]);
    if (!rows[0]) return "accessory type not found";
  } catch {
    return "accessory_type_id must be an item type id or null"; // malformed uuid
  }
  return null;
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/borrows", async () => {
    const active = await query(`select * from active_borrows order by is_overdue desc, due_at`);
    const history = await query(`
      select s.id as session_id, p.email, t.name as item_name, u.asset_id, s.status,
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
    const { rows: [unit] } = await query(`
      select u.item_type_id from borrow_sessions s
      join item_units u on u.id = s.item_unit_id where s.id = $1`, [session_id]);
    if (unit) await processItemAvailability(unit.item_type_id);
    return { session_id, status: "returned" };
  });

  // Returns needing follow-up: flagged contents ("don't wipe") or damage.
  // The queue is a query — resolution just stamps the session.
  app.get("/api/admin/attention", async () => {
    const { rows } = await query(`
      select s.id as session_id, t.name as item_name, u.asset_id, u.id as item_unit_id,
             u.status as unit_status, p.email, p.full_name, s.returned_at,
             s.return_flagged, s.return_damaged, s.return_note,
             s.return_answers, t.return_questions
      from borrow_sessions s
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      join profiles p on p.id = s.user_id
      where (s.return_flagged or s.return_damaged) and s.attention_resolved_at is null
      order by s.returned_at desc`);
    return rows.map(({ return_answers, return_questions, ...r }) => ({
      ...r,
      answers: renderAnswers(return_questions as ReturnQuestion[], return_answers as ReturnAnswers | null),
    }));
  });

  app.post<{ Params: { id: string } }>("/api/admin/attention/:id/resolve", async (req, reply) => {
    const { rows } = await query(`
      update borrow_sessions
      set attention_resolved_at = now(), attention_resolved_by = $2
      where id = $1 and (return_flagged or return_damaged) and attention_resolved_at is null
      returning id`, [req.params.id, req.user!.id]);
    if (rows[0]) return { session_id: rows[0].id, resolved: true };
    const open = await query(
      `select 1 from borrow_sessions where id = $1 and (return_flagged or return_damaged)`,
      [req.params.id]);
    if (!open.rows[0]) return reply.code(404).send({ error: "not found" });
    return reply.code(409).send({ error: "already resolved" });
  });

  // Who has (and had) this unit — current and previous borrowers with dates.
  app.get<{ Params: { id: string } }>("/api/admin/item-units/:id/history", async (req, reply) => {
    const exists = await query(`select 1 from item_units where id = $1`, [req.params.id]);
    if (!exists.rows[0]) return reply.code(404).send({ error: "not found" });
    const { rows } = await query(`
      select s.id as session_id, p.email, p.full_name, s.status,
             s.checked_out_at, s.returned_at, s.return_damaged, s.return_note
      from borrow_sessions s
      join profiles p on p.id = s.user_id
      where s.item_unit_id = $1
      order by s.checked_out_at desc limit 50`, [req.params.id]);
    return rows;
  });

  app.get("/api/admin/item-types", async () => {
    const { rows } = await query(`
      select t.id, t.name, t.category, t.notes, t.return_questions, t.accessory_type_id,
        coalesce(json_agg(json_build_object(
          'id', u.id, 'asset_id', u.asset_id, 'status', u.status,
          'owner', u.owner, 'notes', u.notes, 'created_at', u.created_at) order by u.created_at)
          filter (where u.id is not null), '[]') as units
      from item_types t left join item_units u on u.item_type_id = t.id
      group by t.id order by t.category, t.name`);
    return rows;
  });

  app.post<{ Body: { name?: string; category?: string; notes?: string; return_questions?: unknown;
    accessory_type_id?: unknown } }>(
    "/api/admin/item-types", async (req, reply) => {
      const { name, category, notes, return_questions, accessory_type_id } = req.body ?? {};
      if (!name || !category) return reply.code(400).send({ error: "name and category are required" });
      if (return_questions !== undefined) {
        const err = validateQuestions(return_questions);
        if (err) return reply.code(400).send({ error: err });
      }
      if (accessory_type_id !== undefined) {
        const err = await accessoryLinkError(accessory_type_id, null);
        if (err) return reply.code(400).send({ error: err });
      }
      const dup = await query(
        `select 1 from item_types where lower(trim(name)) = lower(trim($1)) and lower(trim(category)) = lower(trim($2))`,
        [name, category]);
      if (dup.rows[0])
        return reply.code(409).send({ error: "this item already exists in that category — add a unit to it instead" });
      const { rows } = await query(
        `insert into item_types (name, category, notes, return_questions, accessory_type_id)
         values ($1, $2, $3, $4, $5) returning *`,
        [name, category, notes ?? null, JSON.stringify(return_questions ?? []),
         (accessory_type_id as string | undefined) ?? null]);
      return rows[0];
    });

  app.patch<{ Params: { id: string };
    Body: { name?: string; category?: string; notes?: string; return_questions?: unknown;
      accessory_type_id?: unknown } }>(
    "/api/admin/item-types/:id", async (req, reply) => {
      const { return_questions } = req.body ?? {};
      if (return_questions !== undefined) {
        const err = validateQuestions(return_questions);
        if (err) return reply.code(400).send({ error: err });
      }
      const hasAccessory = Object.prototype.hasOwnProperty.call(req.body ?? {}, "accessory_type_id");
      if (hasAccessory) {
        const err = await accessoryLinkError(req.body!.accessory_type_id, req.params.id);
        if (err) return reply.code(400).send({ error: err });
      }
      const { rows } = await query(`
        update item_types set
          name = coalesce($2, name), category = coalesce($3, category),
          notes = coalesce($4, notes),
          return_questions = coalesce($5::jsonb, return_questions),
          accessory_type_id = case when $6 then $7::uuid else accessory_type_id end
        where id = $1 returning *`,
        [req.params.id, req.body?.name ?? null, req.body?.category ?? null, req.body?.notes ?? null,
         return_questions === undefined ? null : JSON.stringify(return_questions),
         hasAccessory, hasAccessory ? (req.body!.accessory_type_id as string | null) : null]);
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
      await processItemAvailability(item_type_id);
      return { created: rows.length };
    });

  // Give every unlabeled, non-retired unit a sequential RACK-NNNN asset id so
  // it can get a printed QR label. Continues from the highest existing number.
  app.post("/api/admin/assign-asset-ids", async () => {
    const { rows } = await query(`
      with base as (
        select coalesce(max(substring(asset_id from '^RACK-(\\d+)$')::int), 0) as n
        from item_units where asset_id ~ '^RACK-\\d+$'),
      numbered as (
        select id, row_number() over (order by created_at) as rn
        from item_units where asset_id is null and status <> 'retired')
      update item_units u
      set asset_id = 'RACK-' || lpad((base.n + numbered.rn)::text, 4, '0')
      from numbered, base where u.id = numbered.id
      returning u.id`);
    return { assigned: rows.length };
  });

  const UNIT_STATUSES = new Set(["available", "in_use", "needs_repair", "retired", "missing"]);

  app.patch<{ Params: { id: string };
    Body: { status?: string; asset_id?: string; owner?: string; notes?: string } }>(
    "/api/admin/item-units/:id", async (req, reply) => {
      const { status, asset_id, owner, notes } = req.body ?? {};
      if (status !== undefined && !UNIT_STATUSES.has(status))
        return reply.code(400).send({ error: "invalid status" });
      // Atomically guard the transition: the WHERE clause excludes flipping to
      // 'available' while an active borrow session still exists, so there is no
      // window between a check and the update for a concurrent borrow to race.
      const { rows } = await query(`
        update item_units set
          status = coalesce($2::unit_status, status), asset_id = coalesce($3, asset_id),
          owner = coalesce($4, owner), notes = coalesce($5, notes)
        where id = $1
          and ($2::text is null or $2::unit_status <> 'available' or not exists (
            select 1 from borrow_sessions where item_unit_id = $1 and status = 'active'))
        returning *`,
        [req.params.id, status ?? null, asset_id ?? null, owner ?? null, notes ?? null]);
      if (rows[0]) {
        if (status === "available") await processItemAvailability(rows[0].item_type_id);
        return rows[0];
      }
      const exists = await query(`select 1 from item_units where id = $1`, [req.params.id]);
      if (!exists.rows[0]) return reply.code(404).send({ error: "not found" });
      return reply.code(409).send({ error: "unit has an active borrow session — return it instead" });
    });
}

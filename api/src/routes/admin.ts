import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { hashPassword, requireAdmin } from "../auth.js";
import { processItemAvailability } from "../requests.js";
import { escapeHtml as esc, sendEmail } from "../mailer.js";
import { sendPushToUser } from "../push.js";
import { validateQuestions, renderAnswers, type ReturnQuestion, type ReturnAnswers } from "../questionnaire.js";

// Tell a requester their checkout approval was decided, on their reminder
// channel (push with email fallback, mirroring reminders).
async function notifyApprovalDecision(userId: string, itemTypeId: string, approved: boolean) {
  const { rows: [u] } = await query(
    `select email, full_name, reminder_channel from profiles where id = $1`, [userId]);
  const { rows: [t] } = await query(`select name from item_types where id = $1`, [itemTypeId]);
  if (!u || !t) return;
  const title = approved
    ? `Your ${t.name} checkout was approved`
    : `Your ${t.name} checkout request was denied`;
  const body = approved
    ? "Open Rack — it's waiting for pickup on My Assets."
    : "Talk to an admin if you think this is a mistake.";
  if (u.reminder_channel === "push"
    && await sendPushToUser(userId, { title, body, url: "/" })) return;
  await sendEmail({
    to: u.email, subject: `Rack: ${title}`,
    html: `<p>Hi ${esc(u.full_name ?? "there")},</p><p>${esc(title)}. ${esc(body)}</p><p>— Rack</p>`,
  });
}

// Give unlabeled, non-retired units sequential RACK-NNNN asset ids,
// continuing from the highest existing number. Unit-creation endpoints pass
// the ids they just inserted so new units never sit unlabeled (uuid
// fallbacks in the admin table) — without retroactively labeling older
// unlabeled units, which stays the assign-asset-ids route's explicit job.
async function assignAssetIds(onlyUnitIds?: string[]): Promise<number> {
  const { rows } = await query(`
    with base as (
      select coalesce(max(substring(asset_id from '^RACK-(\\d+)$')::int), 0) as n
      from item_units where asset_id ~ '^RACK-\\d+$'),
    numbered as (
      select id, row_number() over (order by created_at) as rn
      from item_units
      where asset_id is null and status <> 'retired'
        and ($1::uuid[] is null or id = any($1::uuid[])))
    update item_units u
    set asset_id = 'RACK-' || lpad((base.n + numbered.rn)::text, 4, '0')
    from numbered, base where u.id = numbered.id
    returning u.id`, [onlyUnitIds ?? null]);
  return rows.length;
}

// Accessory-kit link validation: the id must name an existing item type and
// differ from the type being edited. Returns an error message or null.
async function accessoryLinkError(value: unknown, selfId: string | null): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return "accessory_type_id must be an item type id or null";
  if (selfId !== null && value.toLowerCase() === selfId.toLowerCase())
    return "an item type cannot be its own accessory kit";
  try {
    const { rows } = await query(`select 1 from item_types where id = $1`, [value]);
    if (!rows[0]) return "accessory type not found";
  } catch (e: any) {
    if (e?.code === "22P02") return "accessory_type_id must be an item type id or null"; // malformed uuid
    throw e; // real DB failure — don't blame the client
  }
  return null;
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/users", async () => {
    const { rows } = await query(
      `select id, email, full_name, role, created_at from profiles order by created_at`);
    return rows;
  });

  app.patch<{ Params: { id: string }; Body: { role?: string } }>(
    "/api/admin/users/:id", async (req, reply) => {
      const { role } = req.body ?? {};
      if (role !== "admin" && role !== "user")
        return reply.code(400).send({ error: "role must be admin or user" });
      if (req.params.id === req.user!.id)
        return reply.code(409).send({ error: "you cannot change your own role" });
      try {
        // Guarded update: refuses to demote the last remaining admin.
        const { rows } = await query(
          `update profiles set role = $2::user_role
           where id = $1
             and not ($2::text = 'user' and role = 'admin'
               and (select count(*) from profiles where role = 'admin') = 1)
           returning id, email, full_name, role, created_at`,
          [req.params.id, role]);
        if (rows[0]) return rows[0];
        const exists = await query(`select 1 from profiles where id = $1`, [req.params.id]);
        if (!exists.rows[0]) return reply.code(404).send({ error: "not found" });
        return reply.code(409).send({ error: "cannot demote the last admin" });
      } catch (e: any) {
        if (e.code === "22P02") return reply.code(404).send({ error: "not found" });
        throw e;
      }
    });

  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    "/api/admin/users/:id/password", async (req, reply) => {
      const { password } = req.body ?? {};
      if (!password || password.length < 8)
        return reply.code(400).send({ error: "password must be at least 8 characters" });
      if (req.params.id === req.user!.id)
        return reply.code(409).send({ error: "change your own password from your profile page" });
      try {
        const { rows } = await query(
          `update profiles set password_hash = $2 where id = $1 returning id`,
          [req.params.id, await hashPassword(password)]);
        if (!rows[0]) return reply.code(404).send({ error: "not found" });
        // Force the user to sign in again with the new password everywhere.
        await query(`delete from sessions where user_id = $1`, [req.params.id]);
        return { ok: true };
      } catch (e: any) {
        if (e.code === "22P02") return reply.code(404).send({ error: "not found" });
        throw e;
      }
    });

  app.get("/api/admin/allowlist", async () => {
    const { rows } = await query(`select email, created_at from admin_allowlist order by created_at`);
    return rows;
  });

  app.post<{ Body: { email?: string } }>("/api/admin/allowlist", async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    if (!email || !email.includes("@"))
      return reply.code(400).send({ error: "valid email required" });
    const existing = await query(`select 1 from profiles where email = $1`, [email]);
    if (existing.rows[0])
      return reply.code(409).send({ error: "this email already has an account — promote them from the members list" });
    const { rows } = await query(
      `insert into admin_allowlist (email) values ($1)
       on conflict (email) do update set email = excluded.email
       returning email, created_at`, [email]);
    return rows[0];
  });

  app.delete<{ Params: { email: string } }>(
    "/api/admin/allowlist/:email", async (req, reply) => {
      const { rowCount } = await query(
        `delete from admin_allowlist where email = lower($1)`, [req.params.email]);
      if (!rowCount) return reply.code(404).send({ error: "not found" });
      return { ok: true };
    });

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
      let rows;
      try {
        ({ rows } = await query(`
        update item_types set
          name = coalesce($2, name), category = coalesce($3, category),
          notes = coalesce($4, notes),
          return_questions = coalesce($5::jsonb, return_questions),
          accessory_type_id = case when $6 then $7::uuid else accessory_type_id end
        where id = $1 returning *`,
        [req.params.id, req.body?.name ?? null, req.body?.category ?? null, req.body?.notes ?? null,
         return_questions === undefined ? null : JSON.stringify(return_questions),
         hasAccessory, hasAccessory ? (req.body!.accessory_type_id as string | null) : null]));
      } catch (e: any) {
        if (e?.code === "23514")
          return reply.code(400).send({ error: "an item type cannot be its own accessory kit" });
        throw e;
      }
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      return rows[0];
    });

  // Create-and-link an accessory kit for an item type: the kit is what ships
  // in the item's box, so it usually doesn't exist in inventory yet. One call
  // creates the kit type (defaults: "<item> Accessory Kit", the item's
  // category, one kit unit per non-retired item unit) and links it via
  // accessory_type_id. The kit is a normal type from then on.
  app.post<{ Params: { id: string }; Body: { name?: string; count?: number } }>(
    "/api/admin/item-types/:id/accessory-kit", async (req, reply) => {
      const { rows: [parent] } = await query(`
        select t.*, (select count(*)::int from item_units u
                     where u.item_type_id = t.id and u.status <> 'retired') as unit_count
        from item_types t where t.id = $1`, [req.params.id]);
      if (!parent) return reply.code(404).send({ error: "not found" });
      if (parent.accessory_type_id)
        return reply.code(409).send({ error: "this item already has an accessory kit" });
      const name = req.body?.name?.trim() || `${parent.name} Accessory Kit`;
      const count = req.body?.count ?? Math.max(parent.unit_count, 1);
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100)
        return reply.code(400).send({ error: "count must be 1-100" });
      const dup = await query(
        `select 1 from item_types where lower(trim(name)) = lower(trim($1)) and lower(trim(category)) = lower(trim($2))`,
        [name, parent.category]);
      if (dup.rows[0])
        return reply.code(409).send({ error: "a type with this name already exists in that category" });
      const { rows: [kit] } = await query(
        `insert into item_types (name, category) values ($1, $2) returning *`,
        [name, parent.category]);
      const cabinet = await query(`select id from cabinets order by created_at limit 1`);
      const kitUnits = await query(`
        insert into item_units (item_type_id, cabinet_id)
        select $1, $2 from generate_series(1, $3) returning id`,
        [kit.id, cabinet.rows[0]?.id ?? null, count]);
      await assignAssetIds(kitUnits.rows.map((r) => r.id));
      await query(`update item_types set accessory_type_id = $2 where id = $1`,
        [req.params.id, kit.id]);
      await processItemAvailability(kit.id);
      return { ...kit, created_units: count };
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
      await assignAssetIds(rows.map((r) => r.id));
      await processItemAvailability(item_type_id);
      return { created: rows.length };
    });

  app.post("/api/admin/assign-asset-ids", async () => {
    return { assigned: await assignAssetIds() };
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

  // Checkout approvals: pending queue, recent decisions, and the auto/manual mode.
  app.get("/api/admin/approvals", async () => {
    const { rows: [mode] } = await query(
      `select value from app_settings where key = 'borrow_approval_mode'`);
    const { rows: pending } = await query(`
      select a.id, a.requested_at, p.email, p.full_name, t.name as item_name
      from borrow_approvals a
      join profiles p on p.id = a.user_id
      join item_types t on t.id = a.item_type_id
      where a.status = 'pending' order by a.requested_at`);
    const { rows: recent } = await query(`
      select a.id, a.status, a.auto_approved, a.requested_at, a.decided_at,
             p.email, p.full_name, t.name as item_name, d.email as decided_by_email
      from borrow_approvals a
      join profiles p on p.id = a.user_id
      join item_types t on t.id = a.item_type_id
      left join profiles d on d.id = a.decided_by
      where a.status <> 'pending'
      order by coalesce(a.decided_at, a.requested_at) desc limit 50`);
    return { mode: mode?.value ?? "auto", pending, recent };
  });

  app.post<{ Params: { id: string }; Body: { decision?: string } }>(
    "/api/admin/approvals/:id/decide", async (req, reply) => {
      const { decision } = req.body ?? {};
      if (decision !== "approve" && decision !== "deny")
        return reply.code(400).send({ error: "decision must be approve or deny" });
      let row;
      try {
        ({ rows: [row] } = await query(`
          update borrow_approvals set status = $2, decided_at = now(), decided_by = $3
          where id = $1 and status = 'pending'
          returning user_id, item_type_id`,
          [req.params.id, decision === "approve" ? "approved" : "denied", req.user!.id]));
      } catch (e: any) {
        if (e?.code === "22P02") return reply.code(404).send({ error: "approval not found" });
        throw e;
      }
      if (!row) return reply.code(404).send({ error: "approval not found or already decided" });
      notifyApprovalDecision(row.user_id, row.item_type_id, decision === "approve")
        .catch((err) => console.error("approval notification failed", req.params.id, err));
      return { ok: true };
    });

  app.post<{ Body: { mode?: string } }>("/api/admin/approval-mode", async (req, reply) => {
    const { mode } = req.body ?? {};
    if (mode !== "auto" && mode !== "manual")
      return reply.code(400).send({ error: "mode must be auto or manual" });
    await query(`update app_settings set value = $1 where key = 'borrow_approval_mode'`, [mode]);
    return { mode };
  });
}

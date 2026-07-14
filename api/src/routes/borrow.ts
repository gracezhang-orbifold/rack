import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";
import { unlockDoor } from "../seam.js";
import { processItemAvailability } from "../requests.js";
import { escapeHtml as esc, sendEmail } from "../resend.js";
import { validateAnswers, computeFlagged, renderAnswers,
  type ReturnQuestion, type ReturnAnswers, type AnswerPair } from "../questionnaire.js";

// Best-effort admin broadcast — the return itself must not fail on email trouble.
async function emailAdmins(subject: string, html: string) {
  try {
    const { rows: admins } = await query(`select email from profiles where role = 'admin'`);
    for (const a of admins) {
      const result = await sendEmail({ to: a.email, subject, html });
      if (!result.ok) console.error("admin email failed for", a.email);
    }
  } catch (err) {
    console.error("admin notification failed", err);
  }
}

async function itemLabelForSession(sessionId: string) {
  const { rows: [item] } = await query(`
    select t.name, u.asset_id from borrow_sessions s
    join item_units u on u.id = s.item_unit_id
    join item_types t on t.id = u.item_type_id where s.id = $1`, [sessionId]);
  return item ? `${item.name}${item.asset_id ? ` (${item.asset_id})` : ""}` : "an item";
}

// Damaged return: tell every admin what came back broken and who reported it.
async function notifyAdminsOfDamage(sessionId: string, note: string, reporter: { email: string; full_name: string | null }) {
  try {
    const label = await itemLabelForSession(sessionId);
    await emailAdmins(`Rack: damage reported on ${label}`,
      `<p>${esc(reporter.full_name ?? reporter.email)} returned <strong>${esc(label)}</strong> and reported damage:</p>
<blockquote>${esc(note)}</blockquote>
<p>The unit has been set to <strong>needs repair</strong> and won't be borrowable until an admin clears it.</p><p>— Rack</p>`);
  } catch (err) {
    console.error("return notification failed for session", sessionId, err);
  }
}

// Flagged return (e.g. "important contents — don't wipe"): the unit stays
// borrowable, so admins need to act before the next borrower wipes it.
async function notifyAdminsOfFlag(sessionId: string, pairs: AnswerPair[], reporter: { email: string; full_name: string | null }) {
  try {
    const label = await itemLabelForSession(sessionId);
    const fmtVal = (v: string | boolean) => (v === true ? "yes" : v === false ? "no" : v);
    const list = pairs.map((p) => `<li>${esc(p.label)} <strong>${esc(String(fmtVal(p.value)))}</strong></li>`).join("");
    await emailAdmins(`Rack: return flagged for attention — ${label}`,
      `<p>${esc(reporter.full_name ?? reporter.email)} returned <strong>${esc(label)}</strong> with answers that need attention:</p>
<ul>${list}</ul>
<p>The unit is still borrowable — review it in the admin attention queue before someone takes it.</p><p>— Rack</p>`);
  } catch (err) {
    console.error("return notification failed for session", sessionId, err);
  }
}

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
  app.post<{ Body: { item_type_id?: string; days?: number; unit_id?: string } }>(
    "/api/borrow", { preHandler: requireUser }, async (req, reply) => {
      const { item_type_id, days, unit_id } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      // A checkout whose label scan was skipped blocks further borrowing —
      // the database doesn't know which physical unit the user actually has.
      const { rows: pending } = await query(`
        select 1 from borrow_sessions s
        join item_units u on u.id = s.item_unit_id
        where s.user_id = $1 and s.status = 'active'
          and s.unit_confirmed_at is null and u.asset_id is not null
        limit 1`, [req.user!.id]);
      if (pending[0])
        return reply.code(409).send({
          error: "you have an unconfirmed checkout — scan the label on the item you took (My Items tab) before borrowing again",
        });
      // Overdue loans freeze further borrowing: return the item or extend
      // its deadline first. Requests (waitlist/notify/reserve) stay allowed.
      const { rows: overdue } = await query(`
        select 1 from borrow_sessions
        where user_id = $1 and status = 'active' and due_at < now()
        limit 1`, [req.user!.id]);
      if (overdue[0])
        return reply.code(409).send({
          error: "you have an overdue item — return it or extend the deadline before borrowing again",
        });
      let session;
      try {
        const { rows } = await query(`select * from borrow_unit($1, $2, $3, $4)`,
          [req.user!.id, item_type_id, days ?? 7, unit_id ?? null]);
        session = rows[0];
      } catch (e: any) {
        const status = /no units available|not available/.test(e.message) ? 409 : 400;
        return reply.code(status).send({ error: e.message.replace(/^.*?: /, "") });
      }
      // Surface the previous borrower's return report on this exact unit —
      // e.g. "important contents, don't wipe" — before the user opens the door.
      const { rows: [prev] } = await query(`
        select s.return_answers, s.return_flagged, s.return_damaged, s.return_note,
               s.returned_at, t.return_questions
        from borrow_sessions s
        join item_units u on u.id = s.item_unit_id
        join item_types t on t.id = u.item_type_id
        where s.item_unit_id = $1 and s.status = 'returned'
        order by s.returned_at desc limit 1`, [session.item_unit_id]);
      const prevAnswers = prev ? renderAnswers(prev.return_questions, prev.return_answers) : [];
      const last_return = prev && (prev.return_flagged || prev.return_damaged || prevAnswers.length)
        ? { flagged: prev.return_flagged, damaged: prev.return_damaged, note: prev.return_note,
            returned_at: prev.returned_at, answers: prevAnswers }
        : null;
      const lock = await lockForUnit(session.item_unit_id);
      if (!lock) {
        await logEvent({ session_id: session.session_id, user_id: req.user!.id,
          type: "unlock_requested", detail: { skipped: true, reason: "no active Seam lock configured for cabinet" } });
        return { ...session, unlock: "skipped", last_return };
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
      return { ...session, unlock: "ok", last_return };
    });

  // After unlocking, the borrower scans the label on the item they took;
  // this binds the session to that physical unit (swapping if it differs
  // from the unit borrow_unit happened to claim).
  app.post<{ Body: { session_id?: string; asset_id?: string } }>(
    "/api/borrow/confirm", { preHandler: requireUser }, async (req, reply) => {
      const { session_id, asset_id } = req.body ?? {};
      if (!session_id || !asset_id)
        return reply.code(400).send({ error: "session_id and asset_id are required" });
      const { rows: [unit] } = await query(
        `select id from item_units where asset_id = $1 and status <> 'retired'`, [asset_id]);
      if (!unit) return reply.code(404).send({ error: "no item with this asset id" });
      try {
        const { rows } = await query(`select * from confirm_borrow_unit($1, $2, $3)`,
          [session_id, req.user!.id, unit.id]);
        return { ...rows[0], asset_id, confirmed: true };
      } catch (e: any) {
        const msg = e.message.replace(/^.*?: /, "");
        const status = /not found/.test(msg) ? 404
          : /not allowed/.test(msg) ? 403
          : /not active|not available|different item type/.test(msg) ? 409 : 400;
        return reply.code(status).send({ error: msg });
      }
    });

  // Extend an active loan's due date (owner only, capped server-side).
  app.post<{ Body: { session_id?: string; days?: number } }>(
    "/api/borrow/extend", { preHandler: requireUser }, async (req, reply) => {
      const { session_id, days } = req.body ?? {};
      if (!session_id) return reply.code(400).send({ error: "session_id is required" });
      try {
        const { rows } = await query(`select * from extend_borrow($1, $2, $3)`,
          [session_id, req.user!.id, days ?? 7]);
        return rows[0];
      } catch (e: any) {
        const msg = e.message.replace(/^.*?: /, "");
        const status = /not found/.test(msg) ? 404
          : /not allowed/.test(msg) ? 403
          : /not active|beyond 90 days/.test(msg) ? 409 : 400;
        return reply.code(status).send({ error: msg });
      }
    });

  app.post<{ Body: { session_id?: string; asset_id?: string; damaged?: boolean; note?: string;
    answers?: ReturnAnswers } }>(
    "/api/return", { preHandler: requireUser }, async (req, reply) => {
      const { session_id, asset_id, damaged, note, answers } = req.body ?? {};
      if (!session_id) return reply.code(400).send({ error: "session_id is required" });
      if (damaged !== undefined && typeof damaged !== "boolean")
        return reply.code(400).send({ error: "damaged must be a boolean" });
      if (note !== undefined && (typeof note !== "string" || note.length > 500))
        return reply.code(400).send({ error: "note must be a string of at most 500 characters" });
      if (damaged && !note?.trim())
        return reply.code(400).send({ error: "please describe the damage" });
      if (answers !== undefined && (typeof answers !== "object" || answers === null || Array.isArray(answers)))
        return reply.code(400).send({ error: "answers must be an object" });
      const { rows } = await query(
        `select s.id, s.status, s.item_unit_id, s.user_id, u.asset_id, t.return_questions
         from borrow_sessions s
         join item_units u on u.id = s.item_unit_id
         join item_types t on t.id = u.item_type_id
         where s.id = $1`, [session_id]);
      const session = rows[0];
      if (!session || (session.user_id !== req.user!.id && req.user!.role !== "admin"))
        return reply.code(404).send({ error: "session not found" });
      if (session.status !== "active")
        return reply.code(409).send({ error: "session is not active" });
      // Labeled units must be scanned back in, so the return is confirmed
      // against the physical item. The exemption is for returning on someone
      // else's behalf (necessarily an admin, per the ownership guard above) —
      // an admin returning their own loan scans like everyone else.
      if (session.asset_id && session.user_id === req.user!.id) {
        if (!asset_id)
          return reply.code(400).send({ error: "scan the item's label to confirm the return" });
        if (asset_id !== session.asset_id)
          return reply.code(409).send({ error: `that label doesn't match — this loan is for ${session.asset_id}` });
      }
      const questions: ReturnQuestion[] = session.return_questions ?? [];
      const ans: ReturnAnswers = answers ?? {};
      const answerErr = validateAnswers(questions, ans);
      if (answerErr) return reply.code(400).send({ error: answerErr });
      const flagged = computeFlagged(questions, ans);
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
      try {
        await query(`select mark_returned($1, $2, $3, $4, $5, $6, $7)`,
          [session.id, req.user!.id, req.user!.role === "admin",
           damaged ?? false, note?.trim() || null,
           Object.keys(ans).length ? JSON.stringify(ans) : null, flagged]);
      } catch (e: any) {
        // Another concurrent /api/return (or an admin) already closed this
        // session between our status check above and this call — surface it
        // as a 409, not an unhandled 500.
        if (/not active/.test(e.message))
          return reply.code(409).send({ error: "session is not active" });
        throw e;
      }
      if (damaged) {
        await notifyAdminsOfDamage(session.id, note!, req.user!);
      } else {
        // Only a clean return frees the unit — damaged goes to needs_repair.
        const { rows: [unit] } = await query(
          `select item_type_id from item_units where id = $1`, [session.item_unit_id]);
        if (unit) await processItemAvailability(unit.item_type_id);
      }
      if (flagged) {
        await notifyAdminsOfFlag(session.id, renderAnswers(questions, ans), req.user!);
      }
      return { session_id: session.id, status: "returned", damaged: damaged ?? false, flagged };
    });
}

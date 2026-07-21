import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";
import { createAccessCode, deleteAccessCode, unlockDoor } from "../seam.js";
import { processItemAvailability } from "../requests.js";
import { escapeHtml as esc } from "../mailer.js";
import { emailAdmins } from "../notify.js";
import { validateAnswers, validateDraftAnswers, computeFlagged, renderAnswers,
  type ReturnQuestion, type ReturnAnswers, type AnswerPair } from "../questionnaire.js";

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
  app.post<{ Body: { item_type_id?: string; days?: number; unit_id?: string; with_accessory?: boolean;
    access?: string; duration_seconds?: number } }>(
    "/api/borrow", { preHandler: requireUser }, async (req, reply) => {
      const { item_type_id, days, unit_id, with_accessory, access = "unlock", duration_seconds } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      if (with_accessory !== undefined && typeof with_accessory !== "boolean")
        return reply.code(400).send({ error: "with_accessory must be a boolean" });
      if (access !== "unlock" && access !== "code")
        return reply.code(400).send({ error: "access must be unlock or code" });
      // Sub-day loans (custom hours; the 5-second test checkout). The floor of
      // 5 exists purely for that test button.
      if (duration_seconds !== undefined
        && (!Number.isInteger(duration_seconds) || duration_seconds < 5 || duration_seconds > 90 * 86400))
        return reply.code(400).send({ error: "duration_seconds must be 5 seconds to 90 days" });
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
      // Approval gate. Auto mode records an instantly-granted approval and
      // proceeds; manual mode requires an admin-approved request on file,
      // consumed by this checkout, and queues one otherwise. A checkout that
      // fails after consuming an approval hands it back.
      let consumedApprovalId: string | null = null;
      const restoreApproval = async () => {
        if (!consumedApprovalId) return;
        try {
          await query(`update borrow_approvals set status = 'approved' where id = $1`,
            [consumedApprovalId]);
        } catch (err) {
          console.error("approval restore failed", consumedApprovalId, err);
        }
      };
      const { rows: [modeRow] } = await query(
        `select value from app_settings where key = 'borrow_approval_mode'`);
      if ((modeRow?.value ?? "auto") === "auto") {
        await query(`insert into borrow_approvals (user_id, item_type_id, status, auto_approved, decided_at)
          values ($1, $2, 'used', true, now())`, [req.user!.id, item_type_id]);
      } else {
        const { rows: [granted] } = await query(`
          update borrow_approvals set status = 'used'
          where id = (select id from borrow_approvals
            where user_id = $1 and item_type_id = $2 and status = 'approved'
            order by decided_at limit 1)
          returning id`, [req.user!.id, item_type_id]);
        consumedApprovalId = granted?.id ?? null;
        if (!granted) {
          await query(`
            insert into borrow_approvals (user_id, item_type_id)
            select $1, $2 where not exists (
              select 1 from borrow_approvals
              where user_id = $1 and item_type_id = $2 and status = 'pending')`,
            [req.user!.id, item_type_id]);
          return reply.code(409).send({
            error: "this checkout needs admin approval — your request has been sent; try again once it's approved",
          });
        }
      }
      let session;
      try {
        const { rows } = await query(`select * from borrow_unit($1, $2, $3, $4)`,
          [req.user!.id, item_type_id,
           duration_seconds !== undefined ? Math.max(1, Math.ceil(duration_seconds / 86400)) : days ?? 7,
           unit_id ?? null]);
        session = rows[0];
      } catch (e: any) {
        await restoreApproval();
        const status = /no units available|not available/.test(e.message) ? 409 : 400;
        return reply.code(status).send({ error: e.message.replace(/^.*?: /, "") });
      }
      // borrow_unit only stamps whole days; a custom duration re-stamps the
      // due date at second precision.
      if (duration_seconds !== undefined) {
        const { rows: [restamped] } = await query(
          `update borrow_sessions set due_at = checked_out_at + make_interval(secs => $2)
           where id = $1 returning due_at`, [session.session_id, duration_seconds]);
        session.due_at = restamped.due_at;
      }
      // Companion kit: claim a unit of the type's linked accessory type in
      // the same request — a second client call would trip the unconfirmed-
      // checkout guard above. The kit's own link, if any, is never chained.
      let accessory: { session_id: string; item_unit_id: string; due_at: string } | { error: string } | null = null;
      if (with_accessory === true) {
        const { rows: [t] } = await query(
          `select accessory_type_id from item_types where id = $1`, [item_type_id]);
        if (t?.accessory_type_id) {
          let kit;
          try {
            ({ rows: [kit] } = await query(`select * from borrow_unit($1, $2, $3, $4)`,
              [req.user!.id, t.accessory_type_id, days ?? 7, null]));
          } catch (e: any) {
            if (/no units available|not available/.test(e.message)) {
              // Kit pool raced to empty — the camera checkout stands.
              accessory = { error: "no kits available — camera only" };
            } else {
              console.error("kit claim failed for user", req.user!.id, e);
              accessory = { error: "couldn't check out a kit — try borrowing one separately" };
            }
          }
          if (kit) {
            let dueAt = session.due_at;
            try {
              // Pin the kit's due date to the camera's — each borrow_unit call
              // stamps its own now(), drifting the two by milliseconds.
              await query(`update borrow_sessions set due_at = $1 where id = $2`,
                [session.due_at, kit.session_id]);
            } catch (err) {
              console.error("kit due-date pin failed for session", kit.session_id, err);
              dueAt = kit.due_at; // keep the kit; report its actual due date
            }
            accessory = { session_id: kit.session_id, item_unit_id: kit.item_unit_id, due_at: dueAt };
          }
        }
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
        return { ...session, unlock: "skipped", last_return, accessory };
      }
      // Cancel every session this request created; one failed cancel must
      // not strand the other, and the caller still gets the 502 either way.
      const cancelAll = async () => {
        const cancels = [session.session_id];
        if (accessory && "session_id" in accessory) cancels.push(accessory.session_id);
        for (const id of cancels) {
          try {
            await query(`select cancel_borrow_session($1)`, [id]);
          } catch (err) {
            console.error("cancel_borrow_session failed for session", id, err);
          }
        }
        await restoreApproval();
      };

      if (access === "code") {
        // "Unlock later": mint a keypad code valid for 24 hours instead of
        // opening the door now. The borrower types it on the cabinet keypad.
        const expiresAt = new Date(Date.now() + 24 * 3600_000);
        await logEvent({ lock_id: lock.id, session_id: session.session_id,
          user_id: req.user!.id, type: "unlock_requested", detail: { method: "code" } });
        const minted = await createAccessCode(
          lock.seam_device_id, `Rack borrow ${session.session_id.slice(0, 8)}`, new Date(), expiresAt);
        await logEvent({ lock_id: lock.id, session_id: session.session_id,
          user_id: req.user!.id, type: minted.ok ? "unlock_succeeded" : "unlock_failed",
          detail: minted.ok ? { method: "code" } : { method: "code", error: minted.error } });
        if (!minted.ok) {
          await cancelAll();
          return reply.code(502).send({ error: "couldn't create a door code — item not checked out, please retry" });
        }
        await query(
          `update borrow_sessions set access_code = $2, access_code_expires_at = $3, access_code_id = $4 where id = $1`,
          [session.session_id, minted.code, expiresAt, minted.accessCodeId ?? null]);
        return { ...session, unlock: "code",
          access_code: { code: minted.code, ends_at: expiresAt.toISOString() },
          last_return, accessory };
      }

      await logEvent({ lock_id: lock.id, session_id: session.session_id,
        user_id: req.user!.id, type: "unlock_requested" });
      const unlock = await unlockDoor(lock.seam_device_id);
      await logEvent({ lock_id: lock.id, session_id: session.session_id,
        user_id: req.user!.id, type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
        attemptId: unlock.actionAttemptId, detail: unlock.ok ? {} : { error: unlock.error } });
      if (!unlock.ok) {
        await cancelAll();
        return reply.code(502).send({ error: "cabinet did not unlock — item not checked out, please retry" });
      }
      return { ...session, unlock: "ok", last_return, accessory };
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

  // Seam programs keypad codes onto the lock asynchronously (up to ~30 min
  // on TTLock), so a borrower can be standing at the cabinet with a code the
  // keypad doesn't know yet. Any active code checkout may open the door
  // directly instead — same access the code itself would grant.
  app.post<{ Params: { sessionId: string } }>(
    "/api/borrow/:sessionId/unlock", { preHandler: requireUser }, async (req, reply) => {
      let session;
      try {
        ({ rows: [session] } = await query(`
          select id, status, user_id, item_unit_id, access_code, access_code_id
          from borrow_sessions where id = $1`, [req.params.sessionId]));
      } catch (e: any) {
        if (e?.code === "22P02") return reply.code(404).send({ error: "session not found" });
        throw e;
      }
      if (!session || session.user_id !== req.user!.id)
        return reply.code(404).send({ error: "session not found" });
      if (session.status !== "active")
        return reply.code(409).send({ error: "session is not active" });
      if (!session.access_code)
        return reply.code(409).send({ error: "this loan has no door code — the cabinet was already unlocked at checkout" });
      const lock = await lockForUnit(session.item_unit_id);
      if (!lock)
        return reply.code(409).send({ error: "no smart lock is configured for this cabinet" });
      await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
        type: "unlock_requested", detail: { purpose: "code_fallback" } });
      const unlock = await unlockDoor(lock.seam_device_id);
      await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
        type: unlock.ok ? "unlock_succeeded" : "unlock_failed", attemptId: unlock.actionAttemptId,
        detail: unlock.ok ? { purpose: "code_fallback" } : { purpose: "code_fallback", error: unlock.error } });
      if (!unlock.ok)
        return reply.code(502).send({ error: "cabinet did not unlock — please retry" });
      // The door is open, so the keypad code has served its purpose — revoke
      // it rather than leave a live code on the lock. Only forget it locally
      // once Seam confirms, so My Items never hides a code that still works.
      if (session.access_code_id) {
        const del = await deleteAccessCode(session.access_code_id);
        if (del.ok) {
          await query(`update borrow_sessions
            set access_code = null, access_code_expires_at = null, access_code_id = null
            where id = $1`, [session.id]);
        } else {
          console.error("access code revoke failed for session", session.id, del.error);
        }
      }
      return { session_id: session.id, unlocked: true };
    });

  app.post<{ Body: { session_id?: string; asset_id?: string; damaged?: boolean; note?: string;
    answers?: ReturnAnswers; access?: string } }>(
    "/api/return", { preHandler: requireUser }, async (req, reply) => {
      const { session_id, asset_id, damaged, note, answers, access = "unlock" } = req.body ?? {};
      if (!session_id) return reply.code(400).send({ error: "session_id is required" });
      if (access !== "unlock" && access !== "code")
        return reply.code(400).send({ error: "access must be unlock or code" });
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
      // "Return later": mint a keypad code so the borrower can drop the item
      // off within 24 hours. The return is recorded now — the unit becomes
      // borrowable again, trusting the drop-off happens promptly.
      let returnCode: { code: string; ends_at: string } | null = null;
      if (lock && access === "code") {
        const expiresAt = new Date(Date.now() + 24 * 3600_000);
        await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
          type: "unlock_requested", detail: { purpose: "return", method: "code" } });
        const minted = await createAccessCode(
          lock.seam_device_id, `Rack return ${session.id.slice(0, 8)}`, new Date(), expiresAt);
        await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
          type: minted.ok ? "unlock_succeeded" : "unlock_failed",
          detail: minted.ok ? { purpose: "return", method: "code" }
            : { purpose: "return", method: "code", error: minted.error } });
        if (!minted.ok || !minted.code)
          return reply.code(502).send({ error: "couldn't create a door code — item still checked out, please retry" });
        await query(
          `update borrow_sessions set access_code = $2, access_code_expires_at = $3, access_code_id = $4 where id = $1`,
          [session.id, minted.code, expiresAt, minted.accessCodeId ?? null]);
        returnCode = { code: minted.code, ends_at: expiresAt.toISOString() };
      } else if (lock) {
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
      return { session_id: session.id, status: "returned", damaged: damaged ?? false, flagged,
        ...(returnCode ? { access_code: returnCode } : {}) };
    });

  // Pre-answer return questions from My Assets; the return sheet prefills
  // from this draft. Partial answers allowed — completeness is checked at
  // return time, not here.
  app.put<{ Params: { sessionId: string }; Body: { answers?: ReturnAnswers } }>(
    "/api/borrow/:sessionId/draft-answers", { preHandler: requireUser }, async (req, reply) => {
      const { answers } = req.body ?? {};
      if (answers === undefined || typeof answers !== "object" || answers === null || Array.isArray(answers))
        return reply.code(400).send({ error: "answers must be an object" });
      let session;
      try {
        ({ rows: [session] } = await query(`
          select s.id, s.status, s.user_id, t.return_questions
          from borrow_sessions s
          join item_units u on u.id = s.item_unit_id
          join item_types t on t.id = u.item_type_id
          where s.id = $1`, [req.params.sessionId]));
      } catch (e: any) {
        if (e?.code === "22P02") return reply.code(404).send({ error: "session not found" });
        throw e;
      }
      if (!session || session.user_id !== req.user!.id)
        return reply.code(404).send({ error: "session not found" });
      if (session.status !== "active")
        return reply.code(409).send({ error: "session is not active" });
      const err = validateDraftAnswers(session.return_questions ?? [], answers);
      if (err) return reply.code(400).send({ error: err });
      await query(`update borrow_sessions set draft_answers = $2 where id = $1`,
        [session.id, Object.keys(answers).length ? JSON.stringify(answers) : null]);
      return { session_id: session.id, saved: true };
    });
}

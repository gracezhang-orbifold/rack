import cron from "node-cron";
import { query } from "./db.js";
import { escapeHtml as esc, sendEmail } from "./resend.js";
import { sendPushToUser } from "./push.js";

// Deliver on the user's chosen channel. Push silently falls back to email —
// a stale or missing browser subscription must never mean a missed reminder.
async function deliver(
  user: { user_id: string; email: string; full_name: string | null; reminder_channel: string },
  msg: { subject: string; html: string; push_title: string; push_body: string },
): Promise<boolean> {
  if (user.reminder_channel === "push") {
    const pushed = await sendPushToUser(user.user_id,
      { title: msg.push_title, body: msg.push_body, url: "/my-items" });
    if (pushed) return true;
  }
  const result = await sendEmail({ to: user.email, subject: msg.subject, html: msg.html });
  return result.ok;
}

export async function runReminders() {
  // Garbage-collect expired login sessions on the same daily cadence — no
  // separate job needed for a table that only ever grows otherwise.
  await query(`delete from sessions where expires_at < now()`);
  const reservations = await runReservationReminders();
  const preDue = await runPreDueReminders();
  // Overdue nags honor each user's cadence (profiles.overdue_reminder_every_days;
  // 0 = opted out). The 4-hour slack keeps a daily 09:00 run from skipping a
  // day due to clock drift — same idea as the old fixed 20-hour guard.
  const { rows } = await query(`
    select s.id, s.user_id, s.due_at, s.reminder_count, p.email, p.full_name,
           p.reminder_channel, t.name as item_name
    from borrow_sessions s
    join profiles p on p.id = s.user_id
    join item_units u on u.id = s.item_unit_id
    join item_types t on t.id = u.item_type_id
    where s.status = 'active' and s.due_at < now()
      and p.overdue_reminder_every_days > 0
      and (s.last_reminded_at is null
           or s.last_reminded_at < now() - make_interval(hours => p.overdue_reminder_every_days * 24 - 4))`);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  let emailed = 0; const failures: string[] = [];
  for (const sessions of byUser.values()) {
    const { email } = sessions[0];
    try {
      const items = sessions.map((s) =>
        `<li>${esc(s.item_name)} — due ${new Date(s.due_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</li>`).join("");
      const ok = await deliver(sessions[0], {
        subject: `Rack: you have ${sessions.length} overdue item${sessions.length > 1 ? "s" : ""}`,
        html: `<p>Hi ${esc(sessions[0].full_name ?? "there")},</p>
<p>The following borrowed equipment is overdue. Please return it to the cabinet:</p>
<ul>${items}</ul><p>— Rack</p>`,
        push_title: `${sessions.length} overdue item${sessions.length > 1 ? "s" : ""}`,
        push_body: `${sessions.map((s) => s.item_name).join(", ")} — please return to the cabinet.`,
      });
      if (ok) {
        emailed++;
        for (const s of sessions)
          await query(`update borrow_sessions set last_reminded_at = now(),
            reminder_count = $2 where id = $1`, [s.id, s.reminder_count + 1]);
      } else failures.push(email);
    } catch (err) {
      console.error("reminder failed for user", email, err);
      failures.push(email);
    }
  }
  return { overdue_sessions: rows.length, users_emailed: emailed, failures, ...reservations, ...preDue };
}

// Heads-up before the due date, per the user's remind_before_days (0 = none).
// One email per deadline: pre_reminded_at stamps it, and extending the loan
// clears the stamp so the new deadline gets its own heads-up.
async function runPreDueReminders() {
  const { rows } = await query(`
    select s.id, s.user_id, s.due_at, p.email, p.full_name, p.reminder_channel,
           t.name as item_name
    from borrow_sessions s
    join profiles p on p.id = s.user_id
    join item_units u on u.id = s.item_unit_id
    join item_types t on t.id = u.item_type_id
    where s.status = 'active' and s.pre_reminded_at is null
      and p.remind_before_days > 0
      and s.due_at > now()
      and s.due_at <= now() + make_interval(days => p.remind_before_days)`);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  let emailed = 0;
  for (const sessions of byUser.values()) {
    const { email } = sessions[0];
    try {
      const items = sessions.map((s) =>
        `<li>${esc(s.item_name)} — due ${new Date(s.due_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</li>`).join("");
      const ok = await deliver(sessions[0], {
        subject: `Rack: ${sessions.length === 1 ? `${sessions[0].item_name} is` : `${sessions.length} items are`} due back soon`,
        html: `<p>Hi ${esc(sessions[0].full_name ?? "there")},</p>
<p>A heads-up that the following borrowed equipment is due back soon.
Return it to the cabinet, or extend the loan in Rack if you still need it:</p>
<ul>${items}</ul><p>— Rack</p>`,
        push_title: sessions.length === 1
          ? `${sessions[0].item_name} is due back soon`
          : `${sessions.length} items are due back soon`,
        push_body: `${sessions.map((s) => s.item_name).join(", ")} — return or extend in Rack.`,
      });
      if (ok) {
        emailed++;
        for (const s of sessions)
          await query(`update borrow_sessions set pre_reminded_at = now() where id = $1`, [s.id]);
      }
    } catch (err) {
      console.error("pre-due reminder failed for user", email, err);
    }
  }
  return { pre_due_emailed: emailed };
}

// Reservations: email a heads-up within a day of the start date, and retire
// ones whose window has fully passed so they drop out of "my requests".
async function runReservationReminders() {
  await query(`
    update item_requests set status = 'fulfilled'
    where kind = 'reservation' and status = 'active'
      and start_at + make_interval(days => days) < now()`);
  const { rows } = await query(`
    select r.id, r.user_id, r.start_at, r.days, p.email, p.full_name,
           p.reminder_channel, t.name as item_name
    from item_requests r
    join profiles p on p.id = r.user_id
    join item_types t on t.id = r.item_type_id
    where r.kind = 'reservation' and r.status = 'active' and r.notified_at is null
      and r.start_at <= now() + interval '1 day'`);
  let emailed = 0;
  for (const r of rows) {
    try {
      const startsOn = new Date(r.start_at).toLocaleDateString("en-US", { dateStyle: "medium" });
      const result = { ok: await deliver(r, {
        subject: `Rack: your reservation for ${r.item_name} starts soon`,
        html: `<p>Hi ${esc(r.full_name ?? "there")},</p>
<p>Your reservation for <strong>${esc(r.item_name)}</strong> starts
${startsOn}
(${r.days} day${r.days > 1 ? "s" : ""}). Check it out in Rack when you pick it up.</p><p>— Rack</p>`,
        push_title: `Your ${r.item_name} reservation starts soon`,
        push_body: `Starts ${startsOn} (${r.days} day${r.days > 1 ? "s" : ""}) — check it out in Rack.`,
      }) };
      if (result.ok) {
        emailed++;
        await query(`update item_requests set notified_at = now() where id = $1`, [r.id]);
      }
    } catch (err) {
      console.error("reservation reminder failed", r.id, err);
    }
  }
  return { reservations_notified: emailed };
}

export function startReminderCron() {
  // Pin the schedule to a real timezone (not the container's UTC clock) so
  // "9am" reminders actually land at 9am for the office, regardless of what
  // TZ the host/container happens to be running.
  cron.schedule("0 9 * * *", () => {
    runReminders().catch((err) => console.error("reminder run failed", err));
  }, { timezone: process.env.TZ || "America/Los_Angeles" });
}

import cron from "node-cron";
import { query } from "./db.js";
import { sendEmail } from "./resend.js";

export async function runReminders() {
  // Garbage-collect expired login sessions on the same daily cadence — no
  // separate job needed for a table that only ever grows otherwise.
  await query(`delete from sessions where expires_at < now()`);
  const { rows } = await query(`
    select s.id, s.user_id, s.due_at, s.reminder_count, p.email, p.full_name,
           t.name as item_name
    from borrow_sessions s
    join profiles p on p.id = s.user_id
    join item_units u on u.id = s.item_unit_id
    join item_types t on t.id = u.item_type_id
    where s.status = 'active' and s.due_at < now()
      and (s.last_reminded_at is null or s.last_reminded_at < now() - interval '20 hours')`);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  let emailed = 0; const failures: string[] = [];
  for (const sessions of byUser.values()) {
    const { email, full_name } = sessions[0];
    try {
      const items = sessions.map((s) =>
        `<li>${s.item_name} — due ${new Date(s.due_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</li>`).join("");
      const result = await sendEmail({
        to: email,
        subject: `Rack: you have ${sessions.length} overdue item${sessions.length > 1 ? "s" : ""}`,
        html: `<p>Hi ${full_name ?? "there"},</p>
<p>The following borrowed equipment is overdue. Please return it to the cabinet:</p>
<ul>${items}</ul><p>— Rack</p>`,
      });
      if (result.ok) {
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
  return { overdue_sessions: rows.length, users_emailed: emailed, failures };
}

export function startReminderCron() {
  // Pin the schedule to a real timezone (not the container's UTC clock) so
  // "9am" reminders actually land at 9am for the office, regardless of what
  // TZ the host/container happens to be running.
  cron.schedule("0 9 * * *", () => {
    runReminders().catch((err) => console.error("reminder run failed", err));
  }, { timezone: process.env.TZ || "America/Los_Angeles" });
}

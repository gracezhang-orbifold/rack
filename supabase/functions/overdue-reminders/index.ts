// Invoked daily by pg_cron (see 20260710000600_cron.sql), not by users:
// verify_jwt is off and the request must carry the shared cron secret.
// Sends one email per user listing all their overdue items.

import { jsonResponse, serviceClient } from "../_shared/supabase.ts";
import { sendEmail } from "../_shared/resend.ts";

interface OverdueRow {
  id: string;
  user_id: string;
  due_at: string;
  reminder_count: number;
  profiles: { email: string; full_name: string | null };
  item_units: { item_types: { name: string } };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const service = serviceClient();

  // 20h window (not 24h) so daily cron jitter never skips a day.
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await service
    .from("borrow_sessions")
    .select(
      "id, user_id, due_at, reminder_count, profiles(email, full_name), item_units(item_types(name))",
    )
    .eq("status", "active")
    .lt("due_at", new Date().toISOString())
    .or(`last_reminded_at.is.null,last_reminded_at.lt.${cutoff}`);
  if (error) return jsonResponse({ error: error.message }, 500);

  const byUser = new Map<string, OverdueRow[]>();
  for (const row of (rows ?? []) as unknown as OverdueRow[]) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  let emailed = 0;
  const failures: string[] = [];
  for (const sessions of byUser.values()) {
    const { email, full_name } = sessions[0].profiles;
    const items = sessions
      .map(
        (s) =>
          `<li>${s.item_units.item_types.name} — due ${
            new Date(s.due_at).toLocaleDateString("en-US", { dateStyle: "medium" })
          }</li>`,
      )
      .join("");
    const result = await sendEmail({
      to: email,
      subject: `Rack: you have ${sessions.length} overdue item${sessions.length > 1 ? "s" : ""}`,
      html: `<p>Hi ${full_name ?? "there"},</p>
<p>The following borrowed equipment is overdue. Please return it to the cabinet:</p>
<ul>${items}</ul>
<p>— Rack</p>`,
    });

    if (result.ok) {
      emailed++;
      const now = new Date().toISOString();
      for (const s of sessions) {
        await service
          .from("borrow_sessions")
          .update({ last_reminded_at: now, reminder_count: s.reminder_count + 1 })
          .eq("id", s.id);
      }
    } else {
      failures.push(email);
      console.error("reminder email failed", email, result.error);
    }
  }

  return jsonResponse({
    overdue_sessions: rows?.length ?? 0,
    users_emailed: emailed,
    failures,
  });
});

import { query } from "./db.js";
import { escapeHtml as esc, sendEmail } from "./mailer.js";

// A unit of this item type just became available: fulfil every one-shot
// "notify me" subscription, and ping whoever is first on the waitlist.
// Requests are only marked fulfilled after their email actually sends, so a
// failed send stays active for the next availability event. Never throws —
// callers are borrow/return/admin handlers whose response must not depend on
// email delivery.
export async function processItemAvailability(itemTypeId: string) {
  let candidates;
  try {
    candidates = await query(
      `(select r.id, r.kind, p.email, p.full_name, t.name as item_name
          from item_requests r
          join profiles p on p.id = r.user_id
          join item_types t on t.id = r.item_type_id
         where r.item_type_id = $1 and r.status = 'active' and r.kind = 'notify')
       union all
       (select r.id, r.kind, p.email, p.full_name, t.name as item_name
          from item_requests r
          join profiles p on p.id = r.user_id
          join item_types t on t.id = r.item_type_id
         where r.item_type_id = $1 and r.status = 'active' and r.kind = 'waitlist'
         order by r.created_at limit 1)`, [itemTypeId]);
  } catch (err) {
    console.error("availability request lookup failed", err);
    return;
  }
  for (const r of candidates.rows) {
    try {
      const result = await sendEmail({
        to: r.email,
        subject: r.kind === "waitlist"
          ? `Rack: it's your turn — ${r.item_name} is available`
          : `Rack: ${r.item_name} is available`,
        html: `<p>Hi ${esc(r.full_name ?? "there")},</p>
<p>${r.kind === "waitlist"
    ? `You're first on the waitlist for <strong>${esc(r.item_name)}</strong> and a unit just became available.`
    : `<strong>${esc(r.item_name)}</strong> is available again.`}
Grab it in Rack before someone else does — it isn't held for you.</p><p>— Rack</p>`,
      });
      if (result.ok)
        await query(
          `update item_requests set status = 'fulfilled', notified_at = now()
           where id = $1 and status = 'active'`, [r.id]);
    } catch (err) {
      console.error("availability email failed for request", r.id, err);
    }
  }
}

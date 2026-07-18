import { query } from "./db.js";
import { sendEmail } from "./resend.js";

// Best-effort admin broadcast — the caller's operation must not fail on email trouble.
export async function emailAdmins(subject: string, html: string) {
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

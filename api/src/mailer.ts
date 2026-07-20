import { env } from "./env.js";

// Transactional email via Brevo. Read lazily (rather than snapshotting at
// import time) so tests that set BREVO_API_URL/BREVO_API_KEY/EMAIL_FROM after
// env.ts has already loaded (e.g. in a beforeAll) still take effect; env.ts
// remains the source of defaults for everything else.
const brevoApiUrl = () => process.env.BREVO_API_URL ?? env.BREVO_API_URL;
const brevoApiKey = () => process.env.BREVO_API_KEY ?? env.BREVO_API_KEY;
const emailFrom = () => process.env.EMAIL_FROM ?? env.EMAIL_FROM;

export interface SendEmailResult {
  ok: boolean;
  error?: unknown;
}

// Escape a value for interpolation into email HTML. User-controlled strings
// (names, damage notes) and even admin-entered item names must never reach
// the markup raw.
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// EMAIL_FROM is `Name <addr>` or a bare address; Brevo wants the parts split.
function sender(): { name?: string; email: string } {
  const m = emailFrom().match(/^(.*)<([^>]+)>\s*$/);
  return m
    ? { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() }
    : { email: emailFrom().trim() };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  try {
    const res = await fetch(`${brevoApiUrl()}/v3/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": brevoApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: sender(),
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: await res.json().catch(() => res.statusText) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

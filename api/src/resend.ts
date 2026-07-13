import { env } from "./env.js";

// Read lazily (rather than snapshotting at import time) so tests that set
// process.env.RESEND_API_URL/RESEND_API_KEY/EMAIL_FROM after env.ts has already loaded
// (e.g. in a beforeAll) still take effect; env.ts remains the source of
// defaults for everything else.
const resendApiUrl = () => process.env.RESEND_API_URL ?? env.RESEND_API_URL;
const resendApiKey = () => process.env.RESEND_API_KEY ?? env.RESEND_API_KEY;
const emailFrom = () => process.env.EMAIL_FROM ?? env.EMAIL_FROM;

export interface SendEmailResult {
  ok: boolean;
  error?: unknown;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  try {
    const res = await fetch(`${resendApiUrl()}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
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

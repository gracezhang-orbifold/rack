import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";

// Transactional email over SMTP (production: Google Workspace as
// ops@orbifold.ai — smtps://ops%40orbifold.ai:app-password@smtp.gmail.com:465).
// Env is read lazily (rather than snapshotting at import time) so tests that
// set SMTP_URL/EMAIL_FROM after env.ts has already loaded still take effect.
// SMTP_URL "log:" is a dev/smoke sink: log the send and report success.
const smtpUrl = () => process.env.SMTP_URL ?? env.SMTP_URL;
const emailFrom = () => process.env.EMAIL_FROM ?? env.EMAIL_FROM;

let smtpTransport: { url: string; transporter: Transporter } | null = null;
function smtp(): Transporter {
  const url = smtpUrl();
  if (smtpTransport?.url !== url) smtpTransport = { url, transporter: nodemailer.createTransport(url) };
  return smtpTransport.transporter;
}

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

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const url = smtpUrl();
  if (!url) return { ok: false, error: "SMTP_URL not set — email delivery disabled" };
  if (url === "log:") {
    console.log(`[mailer] to=${opts.to} subject=${opts.subject}`);
    return { ok: true };
  }
  try {
    await smtp().sendMail({ from: emailFrom(), to: opts.to, subject: opts.subject, html: opts.html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

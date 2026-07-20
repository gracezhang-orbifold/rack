function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env var ${name}`);
  return v;
}
export const env = {
  DATABASE_URL: req("DATABASE_URL", "postgresql://rack:rack@localhost:5433/rack"),
  PORT: Number(req("PORT", "3000")),
  SESSION_SECRET: req("SESSION_SECRET", "dev-secret"),
  SEAM_API_KEY: req("SEAM_API_KEY", ""),
  SEAM_API_URL: req("SEAM_API_URL", "https://connect.getseam.com"),
  // e.g. smtps://user:pass@smtp.gmail.com:465; "log:" logs instead of
  // sending (dev/smoke); empty disables email delivery.
  SMTP_URL: req("SMTP_URL", ""),
  EMAIL_FROM: req("EMAIL_FROM", "Rack <ops@orbifold.ai>"),
  CRON_ENABLED: req("CRON_ENABLED", "true") === "true",
  NODE_ENV: req("NODE_ENV", "development"),
  // Web push (VAPID). Leave unset to disable push — reminders fall back to email.
  VAPID_PUBLIC_KEY: req("VAPID_PUBLIC_KEY", ""),
  VAPID_PRIVATE_KEY: req("VAPID_PRIVATE_KEY", ""),
  VAPID_SUBJECT: req("VAPID_SUBJECT", "mailto:grace@orbifold.ai"),
};

const insecureSessionSecrets = new Set(["dev-secret", "change-me-long-random"]);
if (env.NODE_ENV === "production" &&
    (!env.SESSION_SECRET || insecureSessionSecrets.has(env.SESSION_SECRET))) {
  throw new Error("SESSION_SECRET must be set in production");
}

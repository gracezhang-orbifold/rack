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
  RESEND_API_KEY: req("RESEND_API_KEY", ""),
  RESEND_API_URL: req("RESEND_API_URL", "https://api.resend.com"),
  EMAIL_FROM: req("EMAIL_FROM", "Rack <onboarding@resend.dev>"),
  CRON_ENABLED: req("CRON_ENABLED", "true") === "true",
  NODE_ENV: req("NODE_ENV", "development"),
};

const insecureSessionSecrets = new Set(["dev-secret", "change-me-long-random"]);
if (env.NODE_ENV === "production" &&
    (!env.SESSION_SECRET || insecureSessionSecrets.has(env.SESSION_SECRET))) {
  throw new Error("SESSION_SECRET must be set in production");
}

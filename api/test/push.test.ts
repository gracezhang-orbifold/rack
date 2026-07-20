import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createECDH, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import webpush from "web-push";
import { vi } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

// Real web-push crypto against a local mock push service: the subscription's
// endpoint points at 127.0.0.1, so sendNotification's encrypted POST lands in
// our hands. /gone answers 410 to exercise dead-subscription pruning.
// Email (the fallback channel) is captured at the nodemailer boundary.
const mail = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (o: { to: string }) => { mail.to.push(o.to); return {}; },
    }),
  },
}));
let pushHits = 0;
let pushMock: Server;

function clientKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

describe("push notifications", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let cookie: string;
  beforeAll(async () => {
    const vapid = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.SMTP_URL = "smtps://mocked-by-vitest";
    // web-push always dials TLS, so the mock push service must speak HTTPS —
    // a throwaway self-signed cert plus disabling verification for this file.
    const certDir = mkdtempSync(join(tmpdir(), "rack-push-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", `${certDir}/key.pem`, "-out", `${certDir}/cert.pem`,
      "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    // Test-only: trust the self-signed mock; restored in afterAll.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    pushMock = createHttpsServer({
      key: readFileSync(`${certDir}/key.pem`), cert: readFileSync(`${certDir}/cert.pem`),
    }, (req, res) => {
      if (req.url === "/gone") { res.statusCode = 410; return res.end(); }
      pushHits++;
      res.statusCode = 201; res.end();
    }).listen(9914);
    await resetDb(); app = await buildServer();
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "pushy@o.ai", password: "pw12345678" } });
    cookie = u.cookies.find((c) => c.name === "rack_session")!.value;
  });
  afterAll(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.SMTP_URL;
    pushMock.close();
  });

  it("settings expose the VAPID key and accept a channel change", async () => {
    const get = await app.inject({ method: "GET", url: "/api/me/settings",
      cookies: { rack_session: cookie } });
    expect(get.json().reminder_channel).toBe("email");
    expect(get.json().vapid_public_key).toBe(process.env.VAPID_PUBLIC_KEY);
    const bad = await app.inject({ method: "PATCH", url: "/api/me/settings",
      payload: { reminder_channel: "pigeon" }, cookies: { rack_session: cookie } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PATCH", url: "/api/me/settings",
      payload: { reminder_channel: "push" }, cookies: { rack_session: cookie } });
    expect(ok.json().reminder_channel).toBe("push");
  });

  it("stores subscriptions, validating the payload", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/push/subscriptions",
      payload: { endpoint: "https://127.0.0.1:9914/ok" }, cookies: { rack_session: cookie } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/push/subscriptions",
      payload: { endpoint: "https://127.0.0.1:9914/ok", keys: clientKeys() },
      cookies: { rack_session: cookie } });
    expect(ok.json().ok).toBe(true);
    const { rows } = await pool.query(`select count(*)::int n from push_subscriptions`);
    expect(rows[0].n).toBe(1);
  });

  it("delivers overdue reminders by push, not email", async () => {
    const t = await pool.query(`select id from item_types where name = 'Tripod'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: cookie } });
    await pool.query(`update borrow_sessions set due_at = now() - interval '2 days',
      checked_out_at = now() - interval '9 days' where id = $1`, [b.json().session_id]);
    const run = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(run.json()).toMatchObject({ overdue_sessions: 1, users_emailed: 1 });
    expect(pushHits).toBe(1);
    expect(mail.to).toEqual([]);
  });

  it("prunes dead subscriptions and falls back to email", async () => {
    await pool.query(`update push_subscriptions set endpoint = 'https://127.0.0.1:9914/gone'`);
    await pool.query(`update borrow_sessions set last_reminded_at = now() - interval '3 days'
      where status = 'active'`);
    const run = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(run.json()).toMatchObject({ overdue_sessions: 1, users_emailed: 1 });
    expect(mail.to).toEqual(["pushy@o.ai"]);
    const { rows } = await pool.query(`select count(*)::int n from push_subscriptions`);
    expect(rows[0].n).toBe(0);
  });
});

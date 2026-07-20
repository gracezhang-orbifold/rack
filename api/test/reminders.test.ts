import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

// Capture outgoing mail at the nodemailer boundary — no SMTP server needed.
const mail = vi.hoisted(() => ({ to: [] as string[], bodies: [] as string[] }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (o: { to: string; html: string }) => {
        mail.to.push(o.to); mail.bodies.push(o.html);
        return {};
      },
    }),
  },
}));

describe("reminders", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    process.env.SMTP_URL = "smtps://mocked-by-vitest";
    await resetDb(); app = await buildServer();
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "late@o.ai", password: "pw12345678" } });
    const cookie = u.cookies.find((c) => c.name === "rack_session")!.value;
    const t = await pool.query(`select id from item_types where name = 'Tripod'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: cookie } });
    await pool.query(`update borrow_sessions set due_at = now() - interval '2 days',
      checked_out_at = now() - interval '9 days' where id = $1`, [b.json().session_id]);
  });
  afterAll(() => { delete process.env.SMTP_URL; });

  it("emails overdue users once, idempotently", async () => {
    const r1 = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(r1.json()).toMatchObject({ overdue_sessions: 1, users_emailed: 1 });
    expect(mail.to).toEqual(["late@o.ai"]);
    const r2 = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(r2.json()).toMatchObject({ overdue_sessions: 0, users_emailed: 0 });
    expect(mail.to).toHaveLength(1);
  });

  it("groups multiple overdue items for the same user into a single email", async () => {
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "late2@o.ai", password: "pw12345678" } });
    const cookie = u.cookies.find((c) => c.name === "rack_session")!.value;

    const t1 = await pool.query(`select id from item_types where name = 'Wrist Strap Mount'`);
    const t2 = await pool.query(`select id from item_types where name = 'AKASO Head Strap Mount'`);
    const b1 = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t1.rows[0].id }, cookies: { rack_session: cookie } });
    const b2 = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t2.rows[0].id }, cookies: { rack_session: cookie } });
    await pool.query(`update borrow_sessions set due_at = now() - interval '2 days',
      checked_out_at = now() - interval '9 days' where id in ($1, $2)`,
      [b1.json().session_id, b2.json().session_id]);

    const before = mail.bodies.length;
    const r = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(r.json()).toMatchObject({ overdue_sessions: 2, users_emailed: 1 });

    const newBodies = mail.bodies.slice(before);
    expect(newBodies).toHaveLength(1);
    expect(newBodies[0]).toContain("Wrist Strap Mount");
    expect(newBodies[0]).toContain("AKASO Head Strap Mount");
  });
});

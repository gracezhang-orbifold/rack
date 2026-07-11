import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

describe("admin", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let admin: string; let user: string;
  beforeAll(async () => {
    await resetDb(); app = await buildServer();
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    user = u.cookies.find((c) => c.name === "rack_session")!.value;
    const a = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "a@o.ai", password: "pw12345678" } });
    admin = a.cookies.find((c) => c.name === "rack_session")!.value;
    await pool.query(`update profiles set role = 'admin' where email = 'a@o.ai'`);
  });

  it("blocks non-admins with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/borrows",
      cookies: { rack_session: user } });
    expect(res.statusCode).toBe(403);
  });
  it("admin return closes another user's session without unlock", async () => {
    const t = await pool.query(`select id from item_types where name = 'Tripod'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: user } });
    const res = await app.inject({ method: "POST", url: "/api/admin/return",
      payload: { session_id: b.json().session_id }, cookies: { rack_session: admin } });
    expect(res.json().status).toBe("returned");
  });
  it("creates units to fix a SEED-TODO type", async () => {
    const t = await pool.query(`select id from item_types where name = 'MacBook Air'`);
    const res = await app.inject({ method: "POST", url: "/api/admin/item-units",
      payload: { item_type_id: t.rows[0].id, count: 2 }, cookies: { rack_session: admin } });
    expect(res.statusCode).toBe(200);
    const avail = await pool.query(
      `select available_units::int a from item_availability where name = 'MacBook Air'`);
    expect(avail.rows[0].a).toBe(2);
  });
  it("rejects marking an in-use unit available", async () => {
    const t = await pool.query(`select id from item_types where name = 'Manus Gloves'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: user } });
    const res = await app.inject({ method: "PATCH",
      url: `/api/admin/item-units/${b.json().item_unit_id}`,
      payload: { status: "available" }, cookies: { rack_session: admin } });
    expect(res.statusCode).toBe(409);
  });
  it("rejects an invalid status value with 400", async () => {
    const t = await pool.query(`select id from item_types where name = 'Manus Gloves'`);
    const u = await pool.query(`select id from item_units where item_type_id = $1 limit 1`,
      [t.rows[0].id]);
    const res = await app.inject({ method: "PATCH",
      url: `/api/admin/item-units/${u.rows[0].id}`,
      payload: { status: "bogus" }, cookies: { rack_session: admin } });
    expect(res.statusCode).toBe(400);
  });
});

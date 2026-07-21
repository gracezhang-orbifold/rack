import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

describe("checkout approvals", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let userCookie: string;
  let adminCookie: string;
  let goproId: string;
  beforeAll(async () => {
    await resetDb(); app = await buildServer();
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    userCookie = u.cookies.find((c) => c.name === "rack_session")!.value;
    const a = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "a@o.ai", password: "pw12345678" } });
    adminCookie = a.cookies.find((c) => c.name === "rack_session")!.value;
    await pool.query(`update profiles set role = 'admin' where email = 'a@o.ai'`);
    goproId = (await pool.query(`select id from item_types where name = 'GoPro 13 Black'`)).rows[0].id;
  });

  const borrow = () => app.inject({ method: "POST", url: "/api/borrow",
    payload: { item_type_id: goproId }, cookies: { rack_session: userCookie } });
  const pendingCount = async () =>
    (await pool.query(`select count(*)::int n from borrow_approvals where status = 'pending'`)).rows[0].n;

  it("auto mode logs an instantly-approved record and checks out", async () => {
    const res = await borrow();
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      `select status, auto_approved from borrow_approvals`);
    expect(rows).toEqual([{ status: "used", auto_approved: true }]);
    await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: res.json().session_id }, cookies: { rack_session: userCookie } });
  });

  it("manual mode queues one pending request and blocks checkout", async () => {
    await pool.query(`update app_settings set value = 'manual' where key = 'borrow_approval_mode'`);
    const res = await borrow();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/needs admin approval/);
    expect(await pendingCount()).toBe(1);
    // A retry while pending doesn't duplicate the request.
    expect((await borrow()).statusCode).toBe(409);
    expect(await pendingCount()).toBe(1);
  });

  it("an admin approval lets the checkout through and is consumed", async () => {
    const list = await app.inject({ method: "GET", url: "/api/admin/approvals",
      cookies: { rack_session: adminCookie } });
    expect(list.json().mode).toBe("manual");
    const id = list.json().pending[0].id;
    const decide = await app.inject({ method: "POST", url: `/api/admin/approvals/${id}/decide`,
      payload: { decision: "approve" }, cookies: { rack_session: adminCookie } });
    expect(decide.json().ok).toBe(true);
    const res = await borrow();
    expect(res.statusCode).toBe(200);
    const { rows: [appr] } = await pool.query(
      `select status from borrow_approvals where id = $1`, [id]);
    expect(appr.status).toBe("used");
    await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: res.json().session_id }, cookies: { rack_session: userCookie } });
  });

  it("a denied request blocks checkout and shows in the recent log", async () => {
    expect((await borrow()).statusCode).toBe(409); // queues a fresh pending
    const list = await app.inject({ method: "GET", url: "/api/admin/approvals",
      cookies: { rack_session: adminCookie } });
    const id = list.json().pending[0].id;
    await app.inject({ method: "POST", url: `/api/admin/approvals/${id}/decide`,
      payload: { decision: "deny" }, cookies: { rack_session: adminCookie } });
    expect((await borrow()).statusCode).toBe(409); // denied grants nothing; re-queues
    expect(await pendingCount()).toBe(1);
    const after = await app.inject({ method: "GET", url: "/api/admin/approvals",
      cookies: { rack_session: adminCookie } });
    expect(after.json().recent.some((r: { status: string }) => r.status === "denied")).toBe(true);
  });

  it("a checkout that fails after consuming an approval hands it back", async () => {
    const list = await app.inject({ method: "GET", url: "/api/admin/approvals",
      cookies: { rack_session: adminCookie } });
    const id = list.json().pending[0].id;
    await app.inject({ method: "POST", url: `/api/admin/approvals/${id}/decide`,
      payload: { decision: "approve" }, cookies: { rack_session: adminCookie } });
    await pool.query(`update item_units set status = 'retired' where item_type_id = $1`, [goproId]);
    const res = await borrow();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/no units available/);
    const { rows: [appr] } = await pool.query(
      `select status from borrow_approvals where id = $1`, [id]);
    expect(appr.status).toBe("approved");
    await pool.query(`update item_units set status = 'available' where item_type_id = $1`, [goproId]);
  });

  it("request → pickup: parameters ride the approval and it's consumed", async () => {
    await pool.query(`update app_settings set value = 'auto' where key = 'borrow_approval_mode'`);
    await pool.query(`update borrow_approvals set status = 'cancelled' where status in ('pending', 'approved')`);
    const reqRes = await app.inject({ method: "POST", url: "/api/borrow/request",
      payload: { item_type_id: goproId, duration_seconds: 3600 },
      cookies: { rack_session: userCookie } });
    expect(reqRes.json().status).toBe("approved"); // auto mode grants instantly
    const id = reqRes.json().id;
    // Re-requesting the same item returns the open request instead of duplicating.
    const again = await app.inject({ method: "POST", url: "/api/borrow/request",
      payload: { item_type_id: goproId }, cookies: { rack_session: userCookie } });
    expect(again.json()).toMatchObject({ id, already_requested: true });
    // It shows on My Assets…
    const mb = await app.inject({ method: "GET", url: "/api/my-borrows",
      cookies: { rack_session: userCookie } });
    expect(mb.json().approvals).toHaveLength(1);
    expect(mb.json().approvals[0]).toMatchObject({ id, status: "approved", duration_seconds: 3600 });
    // …and pickup consumes it, inheriting the 1-hour duration.
    const pick = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { approval_id: id }, cookies: { rack_session: userCookie } });
    expect(pick.statusCode).toBe(200);
    const due = new Date(pick.json().due_at).getTime();
    expect(Math.abs(due - (Date.now() + 3600_000))).toBeLessThan(10_000);
    const { rows: [a] } = await pool.query(`select status from borrow_approvals where id = $1`, [id]);
    expect(a.status).toBe("used");
    // A used approval can't unlock again.
    expect((await app.inject({ method: "POST", url: "/api/borrow",
      payload: { approval_id: id }, cookies: { rack_session: userCookie } })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: pick.json().session_id }, cookies: { rack_session: userCookie } });
  });

  it("a request can be cancelled before pickup", async () => {
    const reqRes = await app.inject({ method: "POST", url: "/api/borrow/request",
      payload: { item_type_id: goproId }, cookies: { rack_session: userCookie } });
    const id = reqRes.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/borrow/request/${id}`,
      cookies: { rack_session: userCookie } });
    expect(del.json().ok).toBe(true);
    const mb = await app.inject({ method: "GET", url: "/api/my-borrows",
      cookies: { rack_session: userCookie } });
    expect(mb.json().approvals).toHaveLength(0);
    // Cancelled approvals can't be picked up.
    expect((await app.inject({ method: "POST", url: "/api/borrow",
      payload: { approval_id: id }, cookies: { rack_session: userCookie } })).statusCode).toBe(409);
  });

  it("mode switching validates input and requires admin", async () => {
    expect((await app.inject({ method: "POST", url: "/api/admin/approval-mode",
      payload: { mode: "auto" }, cookies: { rack_session: userCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/admin/approval-mode",
      payload: { mode: "sometimes" }, cookies: { rack_session: adminCookie } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/admin/approval-mode",
      payload: { mode: "auto" }, cookies: { rack_session: adminCookie } });
    expect(ok.json().mode).toBe("auto");
    expect((await borrow()).statusCode).toBe(200); // auto again — flows freely
  });
});

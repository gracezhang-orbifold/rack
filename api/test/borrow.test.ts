import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

let seamFail = false;
let codesDeleted = 0;
let mock: Server;

function startMockSeam(port: number) {
  mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/locks/unlock_door")
        return res.end(JSON.stringify({ action_attempt: { action_attempt_id: "a1", status: "pending" } }));
      if (req.url === "/action_attempts/get")
        return res.end(JSON.stringify({ action_attempt: seamFail
          ? { action_attempt_id: "a1", status: "error", error: { message: "mock fail" } }
          : { action_attempt_id: "a1", status: "success" } }));
      if (req.url === "/access_codes/create")
        return res.end(JSON.stringify({ access_code: { code: "9137", access_code_id: "ac-1" } }));
      if (req.url === "/access_codes/delete") { codesDeleted++; return res.end("{}"); }
      res.statusCode = 404; res.end("{}");
    });
  }).listen(port);
}

describe("borrow/return", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let cookie: string; let goproId: string;
  beforeAll(async () => {
    process.env.SEAM_API_URL = "http://127.0.0.1:9912";
    startMockSeam(9912);
    await resetDb(); app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    cookie = res.cookies.find((c) => c.name === "rack_session")!.value;
    goproId = (await pool.query(`select id from item_types where name = 'GoPro 13 Black'`)).rows[0].id;
  });
  afterAll(() => mock.close());

  const borrow = (body: object) => app.inject({ method: "POST", url: "/api/borrow",
    payload: body, cookies: { rack_session: cookie } });

  it("skips unlock when no lock is paired", async () => {
    const res = await borrow({ item_type_id: goproId });
    expect(res.statusCode).toBe(200);
    expect(res.json().unlock).toBe("skipped");
  });
  it("unlocks via Seam when a lock is paired, and returns work", async () => {
    await pool.query(`update locks set seam_device_id = 'dev-1'`);
    const res = await borrow({ item_type_id: goproId });
    expect(res.json().unlock).toBe("ok");
    const events = await pool.query(
      `select count(*)::int n from device_events where borrow_session_id = $1`,
      [res.json().session_id]);
    expect(events.rows[0].n).toBe(2);
    const ret = await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: res.json().session_id }, cookies: { rack_session: cookie } });
    expect(ret.json().status).toBe("returned");
  });
  it("cancels the session when Seam fails (502)", async () => {
    seamFail = true;
    const res = await borrow({ item_type_id: goproId });
    expect(res.statusCode).toBe(502);
    const c = await pool.query(`select count(*)::int n from borrow_sessions where status = 'cancelled'`);
    expect(c.rows[0].n).toBe(1);
    seamFail = false;
  });
  it("failure-isolates dual cancel: unlock failure with a kit cancels both sessions and frees both units", async () => {
    const cabinetId = (await pool.query(`select id from cabinets limit 1`)).rows[0].id;
    const { rows: [camera] } = await pool.query(
      `insert into item_types (name, category) values ('Test Kit Camera', 'Camera') returning id`);
    const { rows: [kit] } = await pool.query(
      `insert into item_types (name, category) values ('Test Kit Accessory', 'Accessories') returning id`);
    await pool.query(`update item_types set accessory_type_id = $1 where id = $2`, [kit.id, camera.id]);
    const { rows: [cameraUnit] } = await pool.query(
      `insert into item_units (item_type_id, cabinet_id, status) values ($1, $2, 'available') returning id`,
      [camera.id, cabinetId]);
    const { rows: [kitUnit] } = await pool.query(
      `insert into item_units (item_type_id, cabinet_id, status) values ($1, $2, 'available') returning id`,
      [kit.id, cabinetId]);
    await pool.query(`update locks set seam_device_id = 'dev-1'`);
    seamFail = true;
    const res = await borrow({ item_type_id: camera.id, with_accessory: true });
    expect(res.statusCode).toBe(502);
    const sessions = await pool.query(
      `select status from borrow_sessions where item_unit_id in ($1, $2)`, [cameraUnit.id, kitUnit.id]);
    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows.every((r) => r.status === "cancelled")).toBe(true);
    const units = await pool.query(
      `select status from item_units where id in ($1, $2)`, [cameraUnit.id, kitUnit.id]);
    expect(units.rows).toHaveLength(2);
    expect(units.rows.every((r) => r.status === "available")).toBe(true);
    seamFail = false;
  });
  it("unlocks on demand for a code checkout", async () => {
    await pool.query(`update locks set seam_device_id = 'dev-1'`);
    const res = await borrow({ item_type_id: goproId, access: "code" });
    expect(res.statusCode).toBe(200);
    expect(res.json().unlock).toBe("code");
    expect(res.json().access_code.code).toBe("9137");
    const sid = res.json().session_id;
    const un = await app.inject({ method: "POST", url: `/api/borrow/${sid}/unlock`,
      cookies: { rack_session: cookie } });
    expect(un.statusCode).toBe(200);
    expect(un.json().unlocked).toBe(true);
    // 2 events from minting the code at checkout + 2 from the manual unlock
    const events = await pool.query(
      `select count(*)::int n from device_events where borrow_session_id = $1`, [sid]);
    expect(events.rows[0].n).toBe(4);
    // opening the door revokes the now-unneeded keypad code
    expect(codesDeleted).toBe(1);
    const { rows: [s] } = await pool.query(
      `select access_code, access_code_id from borrow_sessions where id = $1`, [sid]);
    expect(s.access_code).toBeNull();
    expect(s.access_code_id).toBeNull();
    await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: sid }, cookies: { rack_session: cookie } });
  });
  it("mints a return code instead of unlocking when asked", async () => {
    const res = await borrow({ item_type_id: goproId });
    expect(res.json().unlock).toBe("ok");
    const sid = res.json().session_id;
    const ret = await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: sid, access: "code" }, cookies: { rack_session: cookie } });
    expect(ret.statusCode).toBe(200);
    expect(ret.json().status).toBe("returned");
    expect(ret.json().access_code.code).toBe("9137");
  });
  it("manual unlock guards: 409 without a code, 404 for unknown sessions", async () => {
    const res = await borrow({ item_type_id: goproId });
    expect(res.json().unlock).toBe("ok");
    const sid = res.json().session_id;
    const un = await app.inject({ method: "POST", url: `/api/borrow/${sid}/unlock`,
      cookies: { rack_session: cookie } });
    expect(un.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/borrow/not-a-uuid/unlock",
      cookies: { rack_session: cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST",
      url: "/api/borrow/00000000-0000-0000-0000-000000000000/unlock",
      cookies: { rack_session: cookie } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: sid }, cookies: { rack_session: cookie } });
  });
  it("409 when no units available", async () => {
    const oculus = (await pool.query(`select id from item_types where name = 'Oculus'`)).rows[0].id;
    await borrow({ item_type_id: oculus });
    expect((await borrow({ item_type_id: oculus })).statusCode).toBe(409);
  });
});

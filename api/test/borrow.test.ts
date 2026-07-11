import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

let seamFail = false;
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
  it("409 when no units available", async () => {
    const oculus = (await pool.query(`select id from item_types where name = 'Oculus'`)).rows[0].id;
    await borrow({ item_type_id: oculus });
    expect((await borrow({ item_type_id: oculus })).statusCode).toBe(409);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb } from "./helpers.js";

describe("catalog", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let cookie: string;
  beforeAll(async () => {
    await resetDb(); app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    cookie = res.cookies.find((c) => c.name === "rack_session")!.value;
  });
  it("requires auth", async () => {
    expect((await app.inject({ method: "GET", url: "/api/availability" })).statusCode).toBe(401);
  });
  it("returns availability with numeric counts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/availability",
      cookies: { rack_session: cookie } });
    const rows = res.json();
    expect(rows).toHaveLength(28);
    const gopro = rows.find((r: any) => r.name === "GoPro 13 Black");
    expect(gopro.available_units).toBe(3);
  });
  it("my-borrows starts empty", async () => {
    const res = await app.inject({ method: "GET", url: "/api/my-borrows",
      cookies: { rack_session: cookie } });
    expect(res.json()).toEqual({ active: [], history: [], approvals: [] });
  });
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb } from "./helpers.js";
import { env } from "../src/env.js";

describe("auth", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => { await resetDb(); app = await buildServer(); });

  const signup = (body: object) =>
    app.inject({ method: "POST", url: "/api/auth/signup", payload: body });

  it("signs up, sets cookie, /api/me works", async () => {
    const res = await signup({ email: "a@o.ai", password: "pw12345678", full_name: "A" });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "rack_session")!;
    expect(cookie.httpOnly).toBe(true);
    const me = await app.inject({ method: "GET", url: "/api/me",
      cookies: { rack_session: cookie.value } });
    expect(me.json()).toMatchObject({ email: "a@o.ai", role: "user" });
  });
  it("rejects duplicate email with 409 and bad login with 401", async () => {
    expect((await signup({ email: "a@o.ai", password: "pw12345678" })).statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "a@o.ai", password: "wrong" } });
    expect(bad.statusCode).toBe(401);
  });
  it("rejects short passwords with 400 and /api/me without cookie with 401", async () => {
    expect((await signup({ email: "b@o.ai", password: "short" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });
  describe("email domain allowlist", () => {
    afterEach(() => { env.ALLOWED_EMAIL_DOMAIN = ""; });

    it("rejects signup and login from other domains with 403", async () => {
      env.ALLOWED_EMAIL_DOMAIN = "orbifold.ai";
      const res = await signup({ email: "x@gmail.com", password: "pw12345678" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/orbifold\.ai/);
      // a@o.ai signed up while the gate was off; the gate now locks it out
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { email: "a@o.ai", password: "pw12345678" } });
      expect(login.statusCode).toBe(403);
    });
    it("allows allowed-domain signup and login, case-insensitively", async () => {
      env.ALLOWED_EMAIL_DOMAIN = "orbifold.ai";
      const res = await signup({ email: "Grace@Orbifold.AI", password: "pw12345678" });
      expect(res.statusCode).toBe(200);
      expect(res.json().email).toBe("grace@orbifold.ai");
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { email: "grace@orbifold.ai", password: "pw12345678" } });
      expect(login.statusCode).toBe(200);
    });
    it("does not allow lookalike domains like evil-orbifold.ai", async () => {
      env.ALLOWED_EMAIL_DOMAIN = "orbifold.ai";
      const res = await signup({ email: "x@evil-orbifold.ai", password: "pw12345678" });
      expect(res.statusCode).toBe(403);
    });
  });

  it("logout invalidates the session", async () => {
    const res = await signup({ email: "c@o.ai", password: "pw12345678" });
    const cookie = res.cookies.find((c) => c.name === "rack_session")!;
    await app.inject({ method: "POST", url: "/api/auth/logout",
      cookies: { rack_session: cookie.value } });
    const me = await app.inject({ method: "GET", url: "/api/me",
      cookies: { rack_session: cookie.value } });
    expect(me.statusCode).toBe(401);
  });
});

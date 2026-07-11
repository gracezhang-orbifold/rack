import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("health", () => {
  it("responds ok", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./api";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe("api client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns parsed body on success", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { id: "1", email: "a@o.ai", role: "user", full_name: null }));
    await expect(api.me()).resolves.toEqual({ id: "1", email: "a@o.ai", role: "user", full_name: null });
  });

  it("throws ApiError with status and message on failure", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: "email already registered" }));
    await expect(api.signup("a@o.ai", "pw12345678")).rejects.toMatchObject({
      status: 409, message: "email already registered",
    });
    expect((await api.signup("a@o.ai", "pw12345678").catch((e) => e)) instanceof ApiError).toBe(true);
  });

  it("sends credentials and JSON content-type", async () => {
    const f = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", f);
    await api.login("a@o.ai", "pw12345678");
    expect(f).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST", credentials: "include",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });

  it("omits JSON content-type on bodyless requests (Fastify rejects empty JSON bodies)", async () => {
    const f = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", f);
    await api.logout();
    const [, init] = f.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers ?? {})).not.toContain("Content-Type");
  });

  it("returnItem sends answers and omits absent optionals", async () => {
    const f = mockFetch(200, { session_id: "s1", status: "returned", damaged: false, flagged: true });
    vi.stubGlobal("fetch", f);
    await api.returnItem({ session_id: "s1", answers: { q1: "raw files", q2: true } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/return");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      session_id: "s1", answers: { q1: "raw files", q2: true },
    });
  });

  it("resolveAttention posts to the session's resolve route", async () => {
    const f = mockFetch(200, { session_id: "s9", resolved: true });
    vi.stubGlobal("fetch", f);
    await api.resolveAttention("s9");
    expect(f.mock.calls[0][0]).toBe("/api/admin/attention/s9/resolve");
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });
});

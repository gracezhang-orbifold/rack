import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminPeopleScreen } from "./AdminPeopleScreen";
import { ToastProvider } from "../components/ui";

const ME = { id: "u1", email: "admin@rack.local", role: "admin", full_name: "Rack Admin" };
const USERS = [
  { id: "u1", email: "admin@rack.local", full_name: "Rack Admin", role: "admin", created_at: "2026-07-01T00:00:00Z" },
  { id: "u2", email: "user@rack.local", full_name: "Rack User", role: "user", created_at: "2026-07-02T00:00:00Z" },
];
const ALLOWLIST = [{ email: "pending@orbifold.ai", created_at: "2026-07-10T00:00:00Z" }];

function stubFetch(extra?: (path: string, init?: RequestInit) => unknown) {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const hit = extra?.(path, init);
    if (hit) return { ok: true, status: 200, json: async () => hit };
    if (path.endsWith("/api/me")) return { ok: true, status: 200, json: async () => ME };
    if (path.endsWith("/api/admin/users")) return { ok: true, status: 200, json: async () => USERS };
    if (path.endsWith("/api/admin/allowlist") && init?.method !== "POST")
      return { ok: true, status: 200, json: async () => ALLOWLIST };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider><AdminPeopleScreen /></ToastProvider></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("AdminPeopleScreen", () => {
  it("lists members with roles and pending invites", async () => {
    stubFetch();
    wrap();
    expect(await screen.findByText("user@rack.local")).toBeInTheDocument();
    expect(screen.getByText("Rack Admin").closest("tr")!).toHaveTextContent("admin");
    expect(screen.getByText("pending@orbifold.ai", { exact: false })).toBeInTheDocument();
  });

  it("promotes a member via PATCH and hides the button on my own row", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/admin/users/u2") && init?.method === "PATCH")
        return { ...USERS[1], role: "admin" };
      return undefined;
    });
    wrap();
    const userRow = (await screen.findByText("user@rack.local")).closest("tr")!;
    const myRow = screen.getByText("admin@rack.local").closest("tr")!;
    expect(within(myRow).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(within(userRow).getByRole("button", { name: "Make admin" }));
    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) =>
        String(u).endsWith("/api/admin/users/u2") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ role: "admin" });
    });
  });

  it("adds and removes allowlist invites", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/admin/allowlist") && init?.method === "POST")
        return { email: "new@orbifold.ai", created_at: "2026-07-17T00:00:00Z" };
      if (path.includes("/api/admin/allowlist/") && init?.method === "DELETE")
        return { ok: true };
      return undefined;
    });
    wrap();
    await screen.findByText("user@rack.local");

    await userEvent.type(screen.getByPlaceholderText(/teammate@/i), "new@orbifold.ai");
    await userEvent.click(screen.getByRole("button", { name: "Add invite" }));
    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) =>
        String(u).endsWith("/api/admin/allowlist") && (i as RequestInit)?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ email: "new@orbifold.ai" });
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(f.mock.calls.some(([u, i]) =>
        String(u).endsWith("/api/admin/allowlist/pending%40orbifold.ai") && (i as RequestInit)?.method === "DELETE")).toBe(true);
    });
  });
});

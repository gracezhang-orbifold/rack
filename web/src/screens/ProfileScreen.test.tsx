import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileScreen } from "./ProfileScreen";
import { ToastProvider } from "../components/ui";

const ME = { id: "u1", email: "user@rack.local", role: "user", full_name: "Rack User" };

function stubFetch(extra?: (path: string, init?: RequestInit) => unknown) {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const hit = extra?.(path, init);
    if (hit) return { ok: true, status: 200, json: async () => hit };
    if (path.endsWith("/api/me")) return { ok: true, status: 200, json: async () => ME };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider><ProfileScreen /></ToastProvider></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("ProfileScreen", () => {
  it("shows account info and submits a password change", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/auth/change-password") && init?.method === "POST") return { ok: true };
      return undefined;
    });
    wrap();
    expect(await screen.findByText("Rack User")).toBeInTheDocument();
    expect(screen.getByText("user@rack.local")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Current password"), "password123");
    await userEvent.type(screen.getByPlaceholderText(/new password \(8\+/i), "newsecret9");
    await userEvent.type(screen.getByPlaceholderText(/repeat new password/i), "newsecret9");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) =>
        String(u).endsWith("/api/auth/change-password") && (i as RequestInit)?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        current_password: "password123", new_password: "newsecret9",
      });
    });
    // fields cleared on success
    expect(screen.getByPlaceholderText("Current password")).toHaveValue("");
  });

  it("blocks submit while passwords don't match", async () => {
    stubFetch();
    wrap();
    await screen.findByText("Rack User");
    await userEvent.type(screen.getByPlaceholderText("Current password"), "password123");
    await userEvent.type(screen.getByPlaceholderText(/new password \(8\+/i), "newsecret9");
    await userEvent.type(screen.getByPlaceholderText(/repeat new password/i), "different1");
    expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
  });
});

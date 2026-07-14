import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { AdminOverviewScreen } from "./AdminOverviewScreen";
import { ToastProvider } from "../components/ui";

const DATA = {
  active: [
    { session_id: "s1", user_id: "u1", email: "user@rack.local", full_name: "Rack User", item_unit_id: "iu1", asset_id: null, item_name: "GoPro 13 Black", category: "Camera", checked_out_at: "2026-07-01T00:00:00Z", due_at: "2026-07-05T00:00:00Z", is_overdue: true },
  ],
  history: [],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminOverviewScreen /></ToastProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

it("lists who has what with a mark-returned action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(DATA) }));
  wrap();
  expect(await screen.findByText("GoPro 13 Black")).toBeInTheDocument();
  expect(screen.getByText(/user@rack.local/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /mark returned/i })).toBeInTheDocument();
});

const ATTN = [{
  session_id: "s9", item_name: "SD card 128GB", asset_id: "RACK-0102", item_unit_id: "u9",
  unit_status: "available", email: "user@rack.local", full_name: "Rack User",
  returned_at: "2026-07-12T00:00:00Z", return_flagged: true, return_damaged: false, return_note: null,
  answers: [
    { label: "What's on the card?", value: "client shoot raw files" },
    { label: "Important — must not be wiped?", value: true },
  ],
}];

it("shows the attention queue and resolves an item", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/resolve")) return { ok: true, status: 200, json: async () => ({ session_id: "s9", resolved: true }) };
    if (path.endsWith("/api/admin/attention")) return { ok: true, status: 200, json: async () => ATTN };
    return { ok: true, status: 200, json: async () => DATA };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/needs attention/i)).toBeInTheDocument();
  expect(screen.getByText("Flagged")).toBeInTheDocument();
  expect(screen.getByText("client shoot raw files")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() =>
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/admin/attention/s9/resolve"))).toBe(true));
});

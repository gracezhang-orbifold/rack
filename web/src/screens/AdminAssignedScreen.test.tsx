import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { AdminAssignedScreen } from "./AdminAssignedScreen";
import { ToastProvider } from "../components/ui";

const DATA = {
  active: [
    { session_id: "s1", user_id: "u1", email: "user@rack.local", full_name: "Rack User", item_unit_id: "iu1", asset_id: null, item_name: "GoPro 13 Black", category: "Camera", checked_out_at: "2026-07-01T00:00:00Z", due_at: "2026-07-05T00:00:00Z", is_overdue: true },
  ],
  history: [],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminAssignedScreen /></ToastProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

it("lists who has what with a mark-returned action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(DATA) }));
  wrap();
  expect(await screen.findByText("GoPro 13 Black")).toBeInTheDocument();
  expect(screen.getByText(/user@rack.local/i)).toBeInTheDocument();
  expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /mark returned/i })).toBeInTheDocument();
});

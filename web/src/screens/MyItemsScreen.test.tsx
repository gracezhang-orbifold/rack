import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { MyItemsScreen } from "./MyItemsScreen";
import { ToastProvider } from "../components/ui";

const DATA = {
  active: [
    { session_id: "s1", item_name: "GoPro 13 Black", category: "Camera", asset_id: null, checked_out_at: "2026-07-01T00:00:00Z", due_at: "2026-07-05T00:00:00Z", is_overdue: true },
  ],
  history: [
    { session_id: "s0", item_name: "Tripod", status: "returned", checked_out_at: "2026-06-01T00:00:00Z", returned_at: "2026-06-03T00:00:00Z" },
  ],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MyItemsScreen /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

it("shows active borrows and flags overdue", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(DATA) }));
  wrap();
  expect(await screen.findByText("GoPro 13 Black")).toBeInTheDocument();
  expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /return/i })).toBeInTheDocument();
});

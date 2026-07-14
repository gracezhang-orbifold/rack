import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { MyItemsScreen } from "./MyItemsScreen";
import { ToastProvider } from "../components/ui";

const DATA = {
  active: [
    { session_id: "s1", item_name: "GoPro 13 Black", category: "Camera", asset_id: null, checked_out_at: "2026-07-01T00:00:00Z", due_at: "2026-07-05T00:00:00Z", is_overdue: true, unit_confirmed: true },
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
  expect(screen.getByRole("button", { name: /more options/i })).toBeInTheDocument();
});

it("offers scan confirmation for an unconfirmed checkout", async () => {
  const unconfirmed = {
    ...DATA,
    active: [{ ...DATA.active[0], asset_id: "RACK-0044", unit_confirmed: false, is_overdue: false }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/borrow/confirm"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", item_unit_id: "u9", asset_id: "RACK-0048", confirmed: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => unconfirmed };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/scan needed/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Scan ID" }));
  await userEvent.type(await screen.findByPlaceholderText(/type the asset id/i), "RACK-0048");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/confirm"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    session_id: "s1", asset_id: "RACK-0048",
  });
});

it("requires the label scan to return a labeled unit", async () => {
  const labeled = {
    ...DATA,
    active: [{ ...DATA.active[0], asset_id: "RACK-0044", unit_confirmed: true }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/return"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", status: "returned" }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => labeled };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  // The sheet demands the label; the plain confirm button is absent.
  expect(await screen.findByText(/scan the label/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /confirm & unlock/i })).not.toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "RACK-0044");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  expect(await screen.findByText("Cabinet unlocked")).toBeInTheDocument();
  const returnCall = f.mock.calls.find(([u]) => String(u).endsWith("/api/return"));
  expect(JSON.parse((returnCall![1] as RequestInit).body as string)).toEqual({
    session_id: "s1", asset_id: "RACK-0044",
  });
});

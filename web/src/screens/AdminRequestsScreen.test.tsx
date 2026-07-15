import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { AdminRequestsScreen } from "./AdminRequestsScreen";
import { ToastProvider } from "../components/ui";

const ATTN = [{
  session_id: "s9", item_name: "SD card 128GB", asset_id: "RACK-0102", item_unit_id: "u9",
  unit_status: "available", email: "user@rack.local", full_name: "Rack User",
  returned_at: "2026-07-12T00:00:00Z", return_flagged: true, return_damaged: false, return_note: null,
  answers: [{ label: "Important — must not be wiped?", value: true }],
}];
const SRS = [{
  id: "sr1", description: "Lens cover cracked", status: "open", created_at: "2026-07-13T00:00:00Z",
  resolved_at: null, asset_id: "RACK-0007", item_name: "GoPro Hero4",
  item_unit_id: "u7", unit_status: "available", email: "user@rack.local", full_name: "Rack User",
}];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminRequestsScreen /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

it("shows attention and service queues and resolves each", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/admin/attention/s9/resolve"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s9", resolved: true }) };
    if (path.endsWith("/api/admin/service-requests/sr1/resolve"))
      return { ok: true, status: 200, json: async () => ({ id: "sr1", status: "resolved" }) };
    if (path.endsWith("/api/admin/attention")) return { ok: true, status: 200, json: async () => ATTN };
    if (path.endsWith("/api/admin/service-requests")) return { ok: true, status: 200, json: async () => SRS };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/needs attention \(1\)/i)).toBeInTheDocument();
  expect(screen.getByText("Flagged")).toBeInTheDocument();
  expect(await screen.findByText(/service requests \(1\)/i)).toBeInTheDocument();
  expect(screen.getByText("Lens cover cracked")).toBeInTheDocument();

  const buttons = screen.getAllByRole("button", { name: "Resolve" });
  await userEvent.click(buttons[0]);
  await userEvent.click(buttons[1]);
  await waitFor(() => {
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/admin/attention/s9/resolve"))).toBe(true);
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/admin/service-requests/sr1/resolve"))).toBe(true);
  });
});

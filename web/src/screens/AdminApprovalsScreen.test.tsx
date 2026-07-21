import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { AdminApprovalsScreen } from "./AdminApprovalsScreen";
import { ToastProvider } from "../components/ui";

const APPROVALS = {
  mode: "manual",
  pending: [{ id: "ap1", requested_at: "2026-07-20T17:00:00Z", email: "u@o.ai", full_name: "Uma", item_name: "GoPro 13 Black" }],
  recent: [{ id: "ap0", status: "used", auto_approved: true, requested_at: "2026-07-19T10:00:00Z",
    decided_at: "2026-07-19T10:00:00Z", email: "u@o.ai", full_name: "Uma", item_name: "Tripod", decided_by_email: null }],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><AdminApprovalsScreen /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

it("lists pending requests and approves one", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/admin/approvals/ap1/decide"))
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (path.endsWith("/api/admin/approvals")) return { ok: true, status: 200, json: async () => APPROVALS };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText("Pending (1)")).toBeInTheDocument();
  expect(screen.getByText(/Uma · u@o.ai/)).toBeInTheDocument();
  expect(screen.getByText("Auto-approved")).toBeInTheDocument(); // recent log
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() => {
    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/admin/approvals/ap1/decide"));
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ decision: "approve" });
  });
});

it("shows the auto-approve state and toggles the mode", async () => {
  const auto = { ...APPROVALS, mode: "auto", pending: [] };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/admin/approval-mode"))
      return { ok: true, status: 200, json: async () => ({ mode: "manual" }) };
    if (path.endsWith("/api/admin/approvals")) return { ok: true, status: 200, json: async () => auto };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/every checkout is approved instantly/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Require approval" }));

  await waitFor(() => {
    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/admin/approval-mode"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ mode: "manual" });
  });
});

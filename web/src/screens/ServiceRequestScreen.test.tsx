import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { ServiceRequestScreen } from "./ServiceRequestScreen";
import { ToastProvider } from "../components/ui";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ToastProvider><ServiceRequestScreen /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

it("raises a service request from a typed asset id", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/service-requests"))
      return { ok: true, status: 200, json: async () => ({
        id: "sr1", status: "open", created_at: "2026-07-14T00:00:00Z",
        asset_id: "RACK-0007", item_name: "GoPro Hero4" }) };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "RACK-0007");
  await userEvent.click(screen.getByRole("button", { name: "Use ID" }));
  await userEvent.type(screen.getByPlaceholderText(/describe the problem/i), "Lens cover cracked");
  await userEvent.click(screen.getByRole("button", { name: /send service request/i }));

  expect(await screen.findByText(/request sent/i)).toBeInTheDocument();
  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/service-requests"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    asset_id: "RACK-0007", description: "Lens cover cracked",
  });
});

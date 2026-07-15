import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { ScanScreen } from "./ScanScreen";
import { ToastProvider } from "../components/ui";

const UNIT = {
  unit_id: "u1", asset_id: "RACK-0001", status: "available",
  item_type_id: "t1", name: "GoPro 13 Black", category: "Camera",
  accessory: { item_type_id: "t9", name: "GoPro Kit", available_units: 1 },
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={["/scan/RACK-0001"]}>
        <Routes><Route path="/scan/:assetId" element={<ScanScreen />} /></Routes>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

it("offers an opt-in accessory kit and sends with_accessory when checked on a label checkout", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/borrow"))
      return { ok: true, status: 200, json: async () => ({
        session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "ok",
        last_return: null,
        accessory: { session_id: "s2", item_unit_id: "u2", due_at: "2026-07-21T00:00:00Z" },
      }) };
    if (path.includes("/api/units/by-asset/")) return { ok: true, status: 200, json: async () => UNIT };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  const kitBox = await screen.findByRole("checkbox", { name: /also take an accessory kit \(1 available\)/i });
  expect(kitBox).not.toBeChecked(); // kit is opt-in
  await userEvent.click(kitBox);
  await userEvent.click(screen.getByRole("button", { name: /confirm & unlock/i }));
  expect(await screen.findByText(/accessory kit checked out too/i)).toBeInTheDocument();
  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    item_type_id: "t1", days: 7, unit_id: "u1", with_accessory: true,
  });
});

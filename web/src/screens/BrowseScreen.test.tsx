import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowseScreen } from "./BrowseScreen";
import { ToastProvider } from "../components/ui";

const AVAIL = [
  { item_type_id: "t1", name: "GoPro 13 Black", category: "Camera", notes: null, total_units: 3, available_units: 3, in_use_units: 0, needs_repair_units: 0, missing_units: 0, asset_ids: ["RACK-0001"], accessory: null },
  { item_type_id: "t2", name: "Manus Gloves", category: "Tracking", notes: null, total_units: 1, available_units: 0, in_use_units: 1, needs_repair_units: 0, missing_units: 0, asset_ids: [], accessory: null },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<BrowseScreen />} />
          <Route path="/scan/:assetId" element={<div>scan-page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("BrowseScreen", () => {
  it("lists items grouped by category and filters by search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(AVAIL) }));
    wrap();
    expect(await screen.findByText("GoPro 13 Black")).toBeInTheDocument();
    expect(screen.getByText("Manus Gloves")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/search/i), "gopro");
    await waitFor(() => expect(screen.queryByText("Manus Gloves")).not.toBeInTheDocument());
  });

  it("filters by asset id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(AVAIL) }));
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.type(screen.getByPlaceholderText(/search/i), "RACK-0001");
    await waitFor(() => expect(screen.queryByText("Manus Gloves")).not.toBeInTheDocument());
    expect(screen.getByText("GoPro 13 Black")).toBeInTheDocument();
  });

  it("offers waitlist/notify/reserve options when nothing is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      const body = path.endsWith("/api/availability") ? AVAIL : [];
      return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
    }));
    wrap();
    await screen.findByText("Manus Gloves");
    // Unavailable items get an Options button instead of Borrow.
    await userEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(await screen.findByRole("button", { name: "Join waitlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notify me when available" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reserve for a future time" })).toBeInTheDocument();
  });

  it("warns about the previous borrower's flagged return after checkout", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-20T00:00:00Z", unlock: "ok",
          last_return: { flagged: true, damaged: false, note: null, returned_at: "2026-07-12T00:00:00Z",
            answers: [{ label: "Important — must not be wiped?", value: true }] },
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();

    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm & unlock/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Unlock now" }));
    expect(await screen.findByText(/previous borrower flagged/i)).toBeInTheDocument();
    expect(screen.getByText(/must not be wiped/i)).toBeInTheDocument();
  });

  it("scan-label entry routes a bare asset id to the unit's checkout page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(AVAIL) }));
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: /scan label/i }));
    await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "RACK-0012");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByText("scan-page")).toBeInTheDocument();
  });

  it("scan-label entry still accepts old URL-style labels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(AVAIL) }));
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: /scan label/i }));
    await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "http://old-host:3000/scan/RACK-0007");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByText("scan-page")).toBeInTheDocument();
  });

  const AVAIL_KIT = [
    { ...AVAIL[0], accessory: { item_type_id: "t9", name: "GoPro Kit", available_units: 2 } },
    AVAIL[1],
  ];

  it("offers an opt-in accessory kit and sends with_accessory when checked", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "ok",
          last_return: null,
          accessory: { session_id: "s2", item_unit_id: "u2", due_at: "2026-07-21T00:00:00Z" },
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL_KIT };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    const kitBox = await screen.findByRole("checkbox", { name: /also take an accessory kit \(2 available\)/i });
    expect(kitBox).not.toBeChecked(); // kit is opt-in
    await userEvent.click(kitBox);
    await userEvent.click(screen.getByRole("button", { name: /confirm & unlock/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Unlock now" }));
    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, with_accessory: true,
    });
  });

  it("confirms the camera label, then the accessory box label", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/confirm")) {
        const body = JSON.parse((init as RequestInit).body as string);
        return { ok: true, status: 200, json: async () => ({
          session_id: body.session_id, item_unit_id: "x", asset_id: body.asset_id, confirmed: true }) };
      }
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "ok",
          last_return: null,
          accessory: { session_id: "s2", item_unit_id: "u2", due_at: "2026-07-21T00:00:00Z" },
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL_KIT };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /also take an accessory kit/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm & unlock/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Unlock now" }));

    await userEvent.type(await screen.findByPlaceholderText(/type the asset id/i), "RACK-0001");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/now scan the accessory box label/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "RACK-0002");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("All set")).toBeInTheDocument();

    const confirms = f.mock.calls.filter(([u]) => String(u).endsWith("/api/borrow/confirm"))
      .map(([, i]) => JSON.parse((i as RequestInit).body as string));
    expect(confirms).toEqual([
      { session_id: "s1", asset_id: "RACK-0001" },
      { session_id: "s2", asset_id: "RACK-0002" },
    ]);
  });

  it("offers a keypad code for later and shows it after checkout", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "code",
          access_code: { code: "4321", ends_at: "2026-07-18T18:00:00Z" },
          last_return: null, accessory: null,
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getAllByRole("button", { name: "Borrow" })[0]);
    await userEvent.click(screen.getByRole("button", { name: /confirm & unlock/i }));
    await userEvent.click(await screen.findByRole("button", { name: /get a code to unlock later/i }));

    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, access: "code",
    });
    expect(await screen.findByText("4321")).toBeInTheDocument();
    expect(screen.getByText(/your cabinet code/i)).toBeInTheDocument();
    // no scanner step — pickup is later; confirmation happens from My Items
    expect(screen.queryByText(/scan the QR label/i)).not.toBeInTheDocument();
  });
});

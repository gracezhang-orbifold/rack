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

  it("requests approval with the chosen duration and offers My Assets on approval", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/request"))
        return { ok: true, status: 200, json: async () => ({ id: "ap1", status: "approved" }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();

    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    await userEvent.click(await screen.findByRole("button", { name: "Request approval" }));

    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/request"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7,
    });
    // Approved instantly (auto mode) -> hand off to My Assets for the unlock.
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to My Assets" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock now" })).not.toBeInTheDocument();
  });

  it("shows the waiting message when the request stays pending", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/request"))
        return { ok: true, status: 200, json: async () => ({ id: "ap1", status: "pending" }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();

    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    await userEvent.click(await screen.findByRole("button", { name: "Request approval" }));

    expect(await screen.findByText("Request sent")).toBeInTheDocument();
    expect(screen.getByText(/an admin needs to approve/i)).toBeInTheDocument();
  });

  it("sends with_accessory on the request when the kit is checked", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/request"))
        return { ok: true, status: 200, json: async () => ({ id: "ap1", status: "approved" }) };
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
    await userEvent.click(screen.getByRole("button", { name: "Request approval" }));

    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/request"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, with_accessory: true,
    });
  });

  it("requests a 5-second checkout via the test button", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/request"))
        return { ok: true, status: 200, json: async () => ({ id: "ap1", status: "approved" }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getAllByRole("button", { name: "Borrow" })[0]);
    await userEvent.click(await screen.findByRole("button", { name: /check out for 5 seconds/i }));
    await userEvent.click(screen.getByRole("button", { name: "Request approval" }));

    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/request"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, duration_seconds: 5,
    });
  });

  it("requests a custom number of hours", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/request"))
        return { ok: true, status: 200, json: async () => ({ id: "ap1", status: "approved" }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getAllByRole("button", { name: "Borrow" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "hrs" }));
    // hours empty -> request disabled until a valid number is typed
    expect(screen.getByRole("button", { name: "Request approval" })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/how many hours/i), "3");
    await userEvent.click(screen.getByRole("button", { name: "Request approval" }));

    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/request"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, duration_seconds: 3 * 3600,
    });
  });
});

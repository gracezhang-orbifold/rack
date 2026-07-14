import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminInventoryScreen } from "./AdminInventoryScreen";
import { ToastProvider } from "../components/ui";

const INVENTORY = [
  { id: "t1", name: "GoPro 13 Black", category: "Camera", notes: null, accessory_type_id: null, return_questions: [], units: [
    { id: "u1", asset_id: "RACK-0044", status: "available", owner: null, notes: null, created_at: "2026-07-01T00:00:00Z" },
  ] },
  { id: "t2", name: "Manus Gloves", category: "Tracking", notes: null, accessory_type_id: null, return_questions: [], units: [] },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminInventoryScreen /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(INVENTORY) }));
});

describe("AdminInventoryScreen", () => {
  it("filters the list via the search bar (name, category, asset id)", async () => {
    wrap();
    const items = await screen.findAllByRole("listitem");
    // items[0] is t1 card, items[1] is t1 unit, items[2] is t2 card
    expect(within(items[0]).getByText("GoPro 13 Black")).toBeInTheDocument();
    const search = screen.getByPlaceholderText(/search inventory/i);
    await userEvent.type(search, "tracking");
    // After filtering to "tracking", Manus Gloves should be visible
    await waitFor(() => {
      expect(screen.getByText("Manus Gloves")).toBeInTheDocument();
    });
    // GoPro card should not be the first item anymore
    await waitFor(() => {
      const allItems = screen.getAllByRole("listitem");
      const firstCardName = within(allItems[0]).queryByRole("heading") || within(allItems[0]).queryByText(/Camera|Tracking/i);
      expect(firstCardName?.textContent).not.toContain("GoPro");
    });
    await userEvent.clear(search);
    await userEvent.type(search, "rack-0044");
    // After filtering to asset id, GoPro should be visible again
    await waitFor(() => {
      const allItems = screen.getAllByRole("listitem");
      const hasGoPro = allItems.some(item => within(item).queryByText(/GoPro 13 Black/));
      expect(hasGoPro).toBe(true);
    });
  });

  it("flags an existing name+category pair and blocks Add type", async () => {
    wrap();
    const items = await screen.findAllByRole("listitem");
    within(items[0]).getByText("GoPro 13 Black");
    await userEvent.type(screen.getByPlaceholderText("Name"), "gopro 13 black");
    await userEvent.type(screen.getByPlaceholderText("Category"), "camera");
    expect(await screen.findByText(/already exists in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add type" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add a unit to the existing item/i })).toBeInTheDocument();
  });

  it("offers existing categories as suggestions", async () => {
    wrap();
    await screen.findByRole("heading", { name: /inventory/i });
    const options = [...document.querySelectorAll("#category-options option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Camera", "Tracking"]);
  });

  it("adds a return question and saves it on the type", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH")
        return { ok: true, status: 200, json: async () => ({ ...INVENTORY[0] }) };
      if (path.endsWith("/api/admin/item-types")) return { ok: true, status: 200, json: async () => INVENTORY };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();

    const items = await screen.findAllByRole("listitem");
    const goProCard = items[0]; // First item card is t1 (GoPro)
    await userEvent.click(within(goProCard).getByRole("button", { name: /return questions \(0\)/i }));
    await userEvent.type(screen.getByPlaceholderText(/question label/i), "Important — must not be wiped?");
    await userEvent.selectOptions(screen.getByLabelText(/answer type/i), "yes_no");
    await userEvent.click(screen.getByLabelText(/flag for attention if yes/i));
    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getByText("Important — must not be wiped?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save questions" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.return_questions).toHaveLength(1);
      expect(body.return_questions[0]).toMatchObject({
        label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true,
      });
      expect(typeof body.return_questions[0].id).toBe("string");
      expect(body.return_questions[0].id.length).toBeGreaterThan(0);
    });
  });

  it("links an accessory kit type via the select", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH")
        return { ok: true, status: 200, json: async () => ({ ...INVENTORY[0], accessory_type_id: "t2" }) };
      if (path.endsWith("/api/admin/item-types")) return { ok: true, status: 200, json: async () => INVENTORY };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();

    const itemCards = await screen.findAllByRole("listitem");
    within(itemCards[0]).getByText("GoPro 13 Black");
    const selects = screen.getAllByLabelText(/accessory kit/i);
    await userEvent.selectOptions(selects[0], "t2");

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ accessory_type_id: "t2" });
    });
  });
});

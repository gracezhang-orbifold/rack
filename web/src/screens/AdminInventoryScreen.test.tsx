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
  { id: "t2", name: "Manus Gloves", category: "Tracking", notes: null, accessory_type_id: null, return_questions: [], units: [
    { id: "u2", asset_id: "RACK-0050", status: "in_use", owner: null, notes: null, created_at: "2026-07-01T00:00:00Z" },
  ] },
  { id: "t3", name: "MacBook Air", category: "Laptop", notes: null, accessory_type_id: null, return_questions: [], units: [] },
  { id: "t4", name: "AKASO Strap", category: "Camera Accessories", notes: null, accessory_type_id: null, return_questions: [], units: [
    { id: "u3", asset_id: "RACK-0001", status: "available", owner: null, notes: null, created_at: "2026-07-01T00:00:00Z" },
  ] },
];
const BORROWS = {
  active: [
    { session_id: "s1", user_id: "u9", email: "user@rack.local", full_name: "Rack User", item_unit_id: "u2", asset_id: "RACK-0050", item_name: "Manus Gloves", category: "Tracking", checked_out_at: "2026-07-01T00:00:00Z", due_at: "2026-07-20T00:00:00Z", is_overdue: false },
  ],
  history: [],
};

function stubFetch(extra?: (path: string, init?: RequestInit) => unknown) {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const hit = extra?.(path, init);
    if (hit) return { ok: true, status: 200, json: async () => hit };
    if (path.endsWith("/api/admin/borrows")) return { ok: true, status: 200, json: async () => BORROWS };
    if (path.endsWith("/api/admin/item-types")) return { ok: true, status: 200, json: async () => INVENTORY };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminInventoryScreen /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("AdminInventoryScreen (Total Assets table)", () => {
  it("lists units with assigned-to and filters by search, category, and status", async () => {
    stubFetch();
    wrap();
    expect(await screen.findByText("RACK-0044")).toBeInTheDocument();
    // Assigned To resolves from active borrows
    const glovesRow = screen.getByText("RACK-0050").closest("tr")!;
    expect(within(glovesRow).getByText("Rack User")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/search asset/i), "gopro");
    await waitFor(() => expect(screen.queryByText("RACK-0050")).not.toBeInTheDocument());
    await userEvent.clear(screen.getByPlaceholderText(/search asset/i));

    await userEvent.selectOptions(screen.getByLabelText("Category"), "Tracking");
    await waitFor(() => expect(screen.queryByText("RACK-0044")).not.toBeInTheDocument());
    expect(screen.getByText("RACK-0050")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Category"), "");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "available");
    await waitFor(() => expect(screen.queryByText("RACK-0050")).not.toBeInTheDocument());
    expect(screen.getByText("RACK-0044")).toBeInTheDocument();
  });

  it("sorts rows by the Sort by dropdown", async () => {
    stubFetch();
    wrap();
    await screen.findByText("RACK-0044");
    const assetIds = () =>
      screen.getAllByText(/^RACK-/).map((el) => el.textContent);
    // natural order follows type order in the API response
    expect(assetIds()).toEqual(["RACK-0044", "RACK-0050", "RACK-0001"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "name");
    expect(assetIds()).toEqual(["RACK-0001", "RACK-0044", "RACK-0050"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "asset");
    expect(assetIds()).toEqual(["RACK-0001", "RACK-0044", "RACK-0050"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "status");
    // available, available, in_use — RACK-0050 (in_use) sorts last
    expect(assetIds()[2]).toBe("RACK-0050");
  });

  it("shows unit-less types under 'Types without units'", async () => {
    stubFetch();
    wrap();
    await screen.findByText("RACK-0044");
    expect(screen.getByText(/types without units/i)).toBeInTheDocument();
    expect(screen.getByText("MacBook Air")).toBeInTheDocument();
  });

  it("manage-type sheet stages return questions and applies them on Done", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH") return { ...INVENTORY[0] };
      return undefined;
    });
    wrap();

    await screen.findByText("RACK-0044");
    const goProRow = screen.getByText("RACK-0044").closest("tr")!;
    await userEvent.click(within(goProRow).getByRole("button", { name: /manage type/i }));

    await screen.findByRole("dialog");
    await userEvent.type(screen.getByPlaceholderText(/question label/i), "Important — must not be wiped?");
    await userEvent.selectOptions(screen.getByLabelText(/answer type/i), "yes_no");
    await userEvent.click(screen.getByLabelText(/flag for attention if yes/i));
    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    // staged only — nothing written yet
    expect(f.mock.calls.some(([, i]) => (i as RequestInit)?.method === "PATCH")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.return_questions).toHaveLength(1);
      expect(body.return_questions[0]).toMatchObject({
        label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true,
      });
      expect(body.accessory_type_id).toBeUndefined(); // kit untouched
    });
  });

  it("manage-type sheet links an accessory kit on Done", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH") return { ...INVENTORY[0], accessory_type_id: "t2" };
      return undefined;
    });
    wrap();

    await screen.findByText("RACK-0044");
    await userEvent.click(within(screen.getByText("RACK-0044").closest("tr")!).getByRole("button", { name: /manage type/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText(/accessory kit/i), "t2");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ accessory_type_id: "t2" });
    });
  });

  it("manage-type sheet creates a new kit on Done", async () => {
    const f = stubFetch((path) => {
      if (path.endsWith("/api/admin/item-types/t1/accessory-kit"))
        return { id: "t9", name: "GoPro 13 Black Accessory Kit", category: "Camera", created_units: 1 };
      return undefined;
    });
    wrap();

    await screen.findByText("RACK-0044");
    await userEvent.click(within(screen.getByText("RACK-0044").closest("tr")!).getByRole("button", { name: /manage type/i }));
    const dialog = await screen.findByRole("dialog");
    const kitSelect = within(dialog).getByLabelText(/accessory kit/i) as HTMLSelectElement;
    // "+ Create a new kit…" sits right after None, before the type list
    expect([...kitSelect.options].map((o) => o.value).slice(0, 2)).toEqual(["", "__create__"]);
    await userEvent.selectOptions(kitSelect, "__create__");
    expect(screen.getByLabelText("Kit name")).toHaveValue("GoPro 13 Black Accessory Kit");
    expect(screen.getByLabelText("Kit units")).toHaveValue(1);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/admin/item-types/t1/accessory-kit"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        name: "GoPro 13 Black Accessory Kit", count: 1,
      });
    });
  });

  it("manage-type sheet stages added units and applies them on Done", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/admin/item-units") && init?.method === "POST") return { created: 2 };
      return undefined;
    });
    wrap();

    await screen.findByText("RACK-0044");
    await userEvent.click(within(screen.getByText("RACK-0044").closest("tr")!).getByRole("button", { name: /manage type/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "More units" }));
    await userEvent.click(screen.getByRole("button", { name: "More units" }));
    expect(screen.getByText("+2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-units") && (i as RequestInit)?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ item_type_id: "t1", count: 2 });
    });
  });

  it("manage-type sheet Cancel discards staged changes without writing", async () => {
    const f = stubFetch();
    wrap();

    await screen.findByText("RACK-0044");
    await userEvent.click(within(screen.getByText("RACK-0044").closest("tr")!).getByRole("button", { name: /manage type/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "More units" }));
    await userEvent.selectOptions(within(dialog).getByLabelText(/accessory kit/i), "t2");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const writes = f.mock.calls.filter(([, i]) => ["PATCH", "POST", "PUT"].includes((i as RequestInit)?.method ?? ""));
    expect(writes).toHaveLength(0);
  });
});

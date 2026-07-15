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

  it("shows unit-less types under 'Types without units'", async () => {
    stubFetch();
    wrap();
    await screen.findByText("RACK-0044");
    expect(screen.getByText(/types without units/i)).toBeInTheDocument();
    expect(screen.getByText("MacBook Air")).toBeInTheDocument();
  });

  it("manage-type sheet adds return questions on the type", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Save questions" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.return_questions).toHaveLength(1);
      expect(body.return_questions[0]).toMatchObject({
        label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true,
      });
    });
  });

  it("manage-type sheet links an accessory kit via the select", async () => {
    const f = stubFetch((path, init) => {
      if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH") return { ...INVENTORY[0], accessory_type_id: "t2" };
      return undefined;
    });
    wrap();

    await screen.findByText("RACK-0044");
    const goProRow = screen.getByText("RACK-0044").closest("tr")!;
    await userEvent.click(within(goProRow).getByRole("button", { name: /manage type/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText(/accessory kit/i), "t2");

    await waitFor(() => {
      const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ accessory_type_id: "t2" });
    });
  });

  it("manage-type sheet creates and links an accessory kit", async () => {
    const f = stubFetch((path) => {
      if (path.endsWith("/api/admin/item-types/t1/accessory-kit"))
        return { id: "t9", name: "GoPro 13 Black Accessory Kit", category: "Camera", created_units: 1 };
      return undefined;
    });
    wrap();

    await screen.findByText("RACK-0044");
    const goProRow = screen.getByText("RACK-0044").closest("tr")!;
    await userEvent.click(within(goProRow).getByRole("button", { name: /manage type/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /add accessory kit/i }));
    expect(screen.getByLabelText("Kit name")).toHaveValue("GoPro 13 Black Accessory Kit");
    expect(screen.getByLabelText("Kit units")).toHaveValue(1);
    await userEvent.click(screen.getByRole("button", { name: "Create kit" }));

    await waitFor(() => {
      const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/admin/item-types/t1/accessory-kit"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        name: "GoPro 13 Black Accessory Kit", count: 1,
      });
    });
  });
});

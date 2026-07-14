import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminInventoryScreen } from "./AdminInventoryScreen";
import { ToastProvider } from "../components/ui";

const INVENTORY = [
  { id: "t1", name: "GoPro 13 Black", category: "Camera", notes: null, units: [
    { id: "u1", asset_id: "RACK-0044", status: "available", owner: null, notes: null, created_at: "2026-07-01T00:00:00Z" },
  ] },
  { id: "t2", name: "Manus Gloves", category: "Tracking", notes: null, units: [] },
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
    expect(await screen.findByText("GoPro 13 Black")).toBeInTheDocument();
    const search = screen.getByPlaceholderText(/search inventory/i);
    await userEvent.type(search, "tracking");
    await waitFor(() => expect(screen.queryByText("GoPro 13 Black")).not.toBeInTheDocument());
    expect(screen.getByText("Manus Gloves")).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "rack-0044");
    await waitFor(() => expect(screen.queryByText("Manus Gloves")).not.toBeInTheDocument());
    expect(screen.getByText("GoPro 13 Black")).toBeInTheDocument();
  });

  it("flags an existing name+category pair and blocks Add type", async () => {
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.type(screen.getByPlaceholderText("Name"), "gopro 13 black");
    await userEvent.type(screen.getByPlaceholderText("Category"), "camera");
    expect(await screen.findByText(/already exists in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add type" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add a unit to the existing item/i })).toBeInTheDocument();
  });

  it("offers existing categories as suggestions", async () => {
    wrap();
    await screen.findByText("GoPro 13 Black");
    const options = [...document.querySelectorAll("#category-options option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Camera", "Tracking"]);
  });
});

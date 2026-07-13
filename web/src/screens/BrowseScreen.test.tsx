import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowseScreen } from "./BrowseScreen";
import { ToastProvider } from "../components/ui";

const AVAIL = [
  { item_type_id: "t1", name: "GoPro 13 Black", category: "Camera", notes: null, total_units: 3, available_units: 3, in_use_units: 0, needs_repair_units: 0, missing_units: 0 },
  { item_type_id: "t2", name: "Manus Gloves", category: "Tracking", notes: null, total_units: 1, available_units: 0, in_use_units: 1, needs_repair_units: 0, missing_units: 0 },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><BrowseScreen /></ToastProvider></QueryClientProvider>);
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

  it("disables Borrow when nothing is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(AVAIL) }));
    wrap();
    await screen.findByText("Manus Gloves");
    const buttons = screen.getAllByRole("button", { name: /borrow/i });
    // GoPro enabled, Manus disabled
    expect(buttons.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

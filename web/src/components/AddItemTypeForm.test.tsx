import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AddItemTypeForm } from "./AddItemTypeForm";
import { ToastProvider } from "./ui";

const INVENTORY = [
  { id: "t1", name: "GoPro 13 Black", category: "Camera", notes: null, accessory_type_id: null, return_questions: [], units: [] },
  { id: "t2", name: "Manus Gloves", category: "Tracking", notes: null, accessory_type_id: null, return_questions: [], units: [] },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><AddItemTypeForm /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(INVENTORY) }));
});

describe("AddItemTypeForm", () => {
  it("flags an existing name+category pair and blocks Add type", async () => {
    wrap();
    await userEvent.type(screen.getByPlaceholderText("Name"), "gopro 13 black");
    await userEvent.type(screen.getByPlaceholderText("Category"), "camera");
    expect(await screen.findByText(/already exists in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add type" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add a unit to the existing item/i })).toBeInTheDocument();
  });

  it("offers existing categories as suggestions", async () => {
    wrap();
    await userEvent.type(screen.getByPlaceholderText("Name"), "x");
    const options = [...document.querySelectorAll("#category-options option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Camera", "Tracking"]);
  });
});

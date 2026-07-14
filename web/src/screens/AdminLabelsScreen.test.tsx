import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { AdminLabelsScreen } from "./AdminLabelsScreen";
import { ToastProvider } from "../components/ui";

const INVENTORY = [
  { id: "t1", name: "SD Cards", category: "Camera Accessories", notes: null, return_questions: [], units: [
    { id: "u1", asset_id: "RACK-0012", status: "available", owner: null, notes: null, created_at: "2026-07-01T00:00:00Z" },
  ] },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminLabelsScreen /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(INVENTORY) }));
});

// Bare asset id (not a URL) keeps the QR at 21×21 modules so labels print small.
it("encodes the bare asset id in the label QR", async () => {
  wrap();
  expect(await screen.findByAltText("QR code for RACK-0012")).toBeInTheDocument();
});

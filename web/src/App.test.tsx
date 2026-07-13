import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { it, expect, vi } from "vitest";
import App from "./App";
import { ToastProvider } from "./components/ui";

it("shows a loading spinner while auth is resolving", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BrowserRouter><ToastProvider><App /></ToastProvider></BrowserRouter></QueryClientProvider>);
  expect(screen.getByRole("status")).toBeInTheDocument();
});

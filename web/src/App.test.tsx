import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { it, expect, vi } from "vitest";
import App from "./App";
import { ToastProvider } from "./components/ui";

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BrowserRouter><ToastProvider><App /></ToastProvider></BrowserRouter></QueryClientProvider>);
}

it("shows a loading spinner while auth is resolving", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  renderApp();
  expect(screen.getByRole("status")).toBeInTheDocument();
});

it("returns to the auth screen after signing out", async () => {
  const json = (body: unknown, status = 200) =>
    ({ ok: status < 300, status, json: async () => body }) as Response;
  let loggedIn = true;
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/auth/logout")) { loggedIn = false; return json({ ok: true }); }
    if (path.endsWith("/api/me"))
      return loggedIn
        ? json({ id: "1", email: "a@o.ai", role: "user", full_name: null })
        : json({ error: "not authenticated" }, 401);
    return json([]);
  }));
  renderApp();

  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

  expect(await screen.findByText("Sign in to borrow equipment.")).toBeInTheDocument();
});

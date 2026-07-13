import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthScreen } from "./AuthScreen";

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => vi.restoreAllMocks());

describe("AuthScreen", () => {
  it("defaults to sign-in and can toggle to sign-up", async () => {
    wrap(<AuthScreen />);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it("shows the server error message on failed login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({ error: "invalid email or password" }) }));
    wrap(<AuthScreen />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@o.ai");
    await userEvent.type(screen.getByLabelText(/password/i), "wrongpass1");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });
});

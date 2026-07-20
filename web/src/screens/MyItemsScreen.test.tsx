import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { MyItemsScreen } from "./MyItemsScreen";
import { ToastProvider } from "../components/ui";

const DATA = {
  active: [
    { session_id: "s1", item_name: "GoPro 13 Black", category: "Camera", asset_id: null, checked_out_at: "2026-07-01T00:00:00Z", due_at: "2026-07-05T00:00:00Z", is_overdue: true, unit_confirmed: true },
  ],
  history: [
    { session_id: "s0", item_name: "Tripod", status: "returned", checked_out_at: "2026-06-01T00:00:00Z", returned_at: "2026-06-03T00:00:00Z" },
  ],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MyItemsScreen /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

it("shows active borrows and flags overdue", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(DATA) }));
  wrap();
  expect(await screen.findByText("GoPro 13 Black")).toBeInTheDocument();
  expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /more options/i })).toBeInTheDocument();
});

it("offers scan confirmation for an unconfirmed checkout", async () => {
  const unconfirmed = {
    ...DATA,
    active: [{ ...DATA.active[0], asset_id: "RACK-0044", unit_confirmed: false, is_overdue: false }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/borrow/confirm"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", item_unit_id: "u9", asset_id: "RACK-0048", confirmed: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => unconfirmed };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/scan needed/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Scan ID" }));
  await userEvent.type(await screen.findByPlaceholderText(/type the asset id/i), "RACK-0048");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/confirm"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    session_id: "s1", asset_id: "RACK-0048",
  });
});

it("unlocks the cabinet from the menu for a code checkout", async () => {
  const coded = {
    ...DATA,
    active: [{ ...DATA.active[0], is_overdue: false, access_code: "2477", access_code_expires_at: "2099-01-01T00:00:00Z" }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/borrow/s1/unlock"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", unlocked: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => coded };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/cabinet code/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Unlock cabinet" }));

  await waitFor(() =>
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/borrow/s1/unlock"))).toBe(true));
});

it("mints a return code when unlock-later is chosen", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/return"))
      return { ok: true, status: 200, json: async () => ({
        session_id: "s1", status: "returned", damaged: false, flagged: false,
        access_code: { code: "8642", ends_at: "2099-01-01T00:00:00Z" },
      }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => DATA };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  await userEvent.click(await screen.findByRole("button", { name: /get a code to unlock later/i }));

  expect(await screen.findByText("8642")).toBeInTheDocument();
  expect(screen.getByText(/about 30 minutes to start working/i)).toBeInTheDocument();
  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/return"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({
    session_id: "s1", access: "code",
  });
});

const SETTINGS = {
  remind_before_minutes: 1440, overdue_reminder_every_days: 1,
  reminder_channel: "email", vapid_public_key: "QUJDREVGRw",
};

it("saves a custom heads-up lead time in hours", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/api/me/settings") && init?.method === "PATCH")
      return { ok: true, status: 200, json: async () => ({ ...SETTINGS, remind_before_minutes: 180 }) };
    if (path.endsWith("/api/me/settings")) return { ok: true, status: 200, json: async () => SETTINGS };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => DATA };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.selectOptions(await screen.findByLabelText(/heads-up before due/i), "custom");
  const amount = await screen.findByLabelText("Heads-up amount");
  await userEvent.clear(amount);
  await userEvent.type(amount, "3");
  await userEvent.selectOptions(screen.getByLabelText("Heads-up unit"), "hours");
  await userEvent.click(screen.getByRole("button", { name: "Set" }));

  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) =>
      String(u).endsWith("/api/me/settings") && (i as RequestInit)?.method === "PATCH");
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ remind_before_minutes: 180 });
  });
});

it("offers only email reminders when the browser can't do push", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/me/settings")) return { ok: true, status: 200, json: async () => SETTINGS };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => DATA };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();
  expect(await screen.findByLabelText(/remind me by/i)).toBeInTheDocument();
  // jsdom has no PushManager — exactly like un-installed iOS Safari
  expect(screen.queryByRole("option", { name: /push notification/i })).not.toBeInTheDocument();
});

it("subscribes to push when that channel is chosen", async () => {
  const subscribe = vi.fn().mockResolvedValue({
    toJSON: () => ({ endpoint: "https://push.example/e1", keys: { p256dh: "p", auth: "a" } }),
  });
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(), ready: Promise.resolve({ pushManager: { subscribe } }) },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/api/me/settings") && init?.method === "PATCH")
      return { ok: true, status: 200, json: async () => ({ ...SETTINGS, reminder_channel: "push" }) };
    if (path.endsWith("/api/me/settings")) return { ok: true, status: 200, json: async () => SETTINGS };
    if (path.endsWith("/api/push/subscriptions")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => DATA };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.selectOptions(await screen.findByLabelText(/remind me by/i), "push");

  await waitFor(() =>
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/push/subscriptions"))).toBe(true));
  expect(subscribe).toHaveBeenCalled();
  const patchCall = f.mock.calls.find(([u, i]) =>
    String(u).endsWith("/api/me/settings") && (i as RequestInit)?.method === "PATCH");
  expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({ reminder_channel: "push" });

  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  vi.unstubAllGlobals();
});

it("hides the unlock button for checkouts without a code", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(DATA) }));
  wrap();
  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  expect(await screen.findByRole("button", { name: "Return" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Unlock cabinet" })).not.toBeInTheDocument();
});

it("requires the label scan to return a labeled unit", async () => {
  const labeled = {
    ...DATA,
    active: [{ ...DATA.active[0], asset_id: "RACK-0044", unit_confirmed: true }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/return"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", status: "returned" }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => labeled };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  // The sheet demands the label; no unlock choice until it's scanned.
  expect(await screen.findByText(/scan the label/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Unlock now" })).not.toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "RACK-0044");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  // Label accepted → choose how to open the cabinet.
  expect(await screen.findByText(/label confirmed/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Unlock now" }));

  expect(await screen.findByText("Cabinet unlocked")).toBeInTheDocument();
  const returnCall = f.mock.calls.find(([u]) => String(u).endsWith("/api/return"));
  expect(JSON.parse((returnCall![1] as RequestInit).body as string)).toEqual({
    session_id: "s1", asset_id: "RACK-0044",
  });
});

it("rejects a mismatched label before offering the unlock choice", async () => {
  const labeled = {
    ...DATA,
    active: [{ ...DATA.active[0], asset_id: "RACK-0044", unit_confirmed: true }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => labeled };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  await userEvent.type(await screen.findByPlaceholderText(/type the asset id/i), "RACK-0099");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  expect(await screen.findByText(/that label doesn't match/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Unlock now" })).not.toBeInTheDocument();
  expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/return"))).toBe(false);
});

it("asks return questions and blocks until every yes/no is answered", async () => {
  const withQuestions = {
    ...DATA,
    active: [{ ...DATA.active[0], is_overdue: false, return_questions: [
      { id: "q1", label: "What's on the card?", kind: "text" },
      { id: "q2", label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true },
    ] }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/return"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", status: "returned", damaged: false, flagged: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => withQuestions };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  expect(await screen.findByText("What's on the card?")).toBeInTheDocument();

  const confirm = screen.getByRole("button", { name: "Unlock now" });
  expect(confirm).toBeDisabled(); // q2 unanswered

  await userEvent.type(screen.getByLabelText(/what's on the card/i), "beach shoot raws");
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);

  expect(await screen.findByText("Cabinet unlocked")).toBeInTheDocument();
  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/return"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    session_id: "s1", answers: { q1: "beach shoot raws", q2: true },
  });
});

it("saves draft answers from the menu without returning", async () => {
  const withQuestions = {
    ...DATA,
    active: [{ ...DATA.active[0], is_overdue: false, draft_answers: null, return_questions: [
      { id: "q1", label: "What's on the card?", kind: "text" },
      { id: "q2", label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true },
    ] }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/borrow/s1/draft-answers"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", saved: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => withQuestions };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Answer return questions" }));
  await userEvent.type(screen.getByLabelText(/what's on the card/i), "beach shoot raws");
  await userEvent.click(screen.getByRole("button", { name: "Save answers" }));

  await waitFor(() => {
    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow/s1/draft-answers"));
    expect(call).toBeTruthy();
    expect((call![1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      answers: { q1: "beach shoot raws" },
    });
  });
});

it("prefills the return sheet from a saved draft", async () => {
  const withDraft = {
    ...DATA,
    active: [{ ...DATA.active[0], is_overdue: false,
      draft_answers: { q1: "beach shoot raws", q2: true },
      return_questions: [
        { id: "q1", label: "What's on the card?", kind: "text" },
        { id: "q2", label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true },
      ] }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => withDraft };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  // Draft answers arrive prefilled: text filled in, Yes pressed, submit enabled.
  expect(await screen.findByLabelText(/what's on the card/i)).toHaveValue("beach shoot raws");
  expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Unlock now" })).toBeEnabled();
});

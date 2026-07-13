import { describe, it, expect } from "vitest";
import { borrowResultMessage, errorMessage } from "./borrowResult";
import { ApiError } from "./api";

describe("borrowResultMessage", () => {
  it("ok → unlocked", () => {
    expect(borrowResultMessage({ unlock: "ok" }).title).toBe("Cabinet unlocked");
  });
  it("skipped → checked out, find admin", () => {
    expect(borrowResultMessage({ unlock: "skipped" }).body).toMatch(/find an admin/i);
  });
});

describe("errorMessage", () => {
  it("409 → friendly race message", () => {
    expect(errorMessage(new ApiError(409, "no units available for this item type"))).toMatch(/someone just took/i);
  });
  it("502 → relays server message", () => {
    expect(errorMessage(new ApiError(502, "cabinet did not unlock — item not checked out, please retry")))
      .toMatch(/did not unlock/);
  });
  it("network error → can't reach Rack", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/can't reach rack/i);
  });
});

import { ApiError } from "./api";

export function borrowResultMessage(r: { unlock: "ok" | "skipped" }): { title: string; body: string } {
  if (r.unlock === "skipped") {
    return { title: "Checked out", body: "Cabinet not connected — find an admin to get your item." };
  }
  return { title: "Cabinet unlocked", body: "Take your item and close the door." };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // Only the stock-race 409s get the friendly copy — other conflicts
    // (unconfirmed checkout, label mismatch) carry their own message.
    if (e.status === 409 && /available/.test(e.message))
      return "Someone just took the last one — refreshing the list.";
    return e.message;
  }
  return "Can't reach Rack — check your connection.";
}

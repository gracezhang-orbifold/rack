// Minimal Seam client: unlock a door and wait for the action attempt to settle.
// SEAM_API_URL is overridable so tests can point at a mock or sandbox.

import { env } from "./env.js";

// Read lazily (rather than snapshotting at import time) so tests that set
// process.env.SEAM_API_URL/SEAM_API_KEY after env.ts has already loaded
// (e.g. in a beforeAll) still take effect; env.ts remains the source of
// defaults for everything else.
const seamApiUrl = () => process.env.SEAM_API_URL ?? env.SEAM_API_URL;
const seamApiKey = () => process.env.SEAM_API_KEY ?? env.SEAM_API_KEY;

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 10_000;

export interface UnlockResult {
  ok: boolean;
  actionAttemptId?: string;
  error?: unknown;
}

async function seamPost(path: string, body: unknown): Promise<Response> {
  return await fetch(`${seamApiUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${seamApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export interface AccessCodeResult {
  ok: boolean;
  code?: string;
  error?: unknown;
}

// Mint a time-bound keypad code on the lock ("unlock later"). The code is
// known immediately from the create response; the gateway programs it onto
// the lock in the background.
export async function createAccessCode(
  deviceId: string, name: string, startsAt: Date, endsAt: Date,
): Promise<AccessCodeResult> {
  try {
    const res = await seamPost("/access_codes/create", {
      device_id: deviceId, name,
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    });
    if (!res.ok) {
      return { ok: false, error: await res.json().catch(() => res.statusText) };
    }
    const code: string | undefined = (await res.json())?.access_code?.code;
    if (!code) return { ok: false, error: "no code in Seam response" };
    return { ok: true, code };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function unlockDoor(deviceId: string): Promise<UnlockResult> {
  try {
    const res = await seamPost("/locks/unlock_door", { device_id: deviceId });
    if (!res.ok) {
      return { ok: false, error: await res.json().catch(() => res.statusText) };
    }
    const attemptId: string | undefined =
      (await res.json())?.action_attempt?.action_attempt_id;
    if (!attemptId) {
      return { ok: false, error: "no action_attempt_id in Seam response" };
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const poll = await seamPost("/action_attempts/get", {
        action_attempt_id: attemptId,
      });
      if (!poll.ok) {
        return {
          ok: false,
          actionAttemptId: attemptId,
          error: await poll.json().catch(() => poll.statusText),
        };
      }
      const attempt = (await poll.json())?.action_attempt;
      if (attempt?.status === "success") {
        return { ok: true, actionAttemptId: attemptId };
      }
      if (attempt?.status === "error") {
        return { ok: false, actionAttemptId: attemptId, error: attempt.error };
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return { ok: false, actionAttemptId: attemptId, error: "unlock timed out" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

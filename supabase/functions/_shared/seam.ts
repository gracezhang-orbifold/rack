// Minimal Seam client: unlock a door and wait for the action attempt to settle.
// SEAM_API_URL is overridable so tests can point at a mock or sandbox.

const SEAM_API_URL = Deno.env.get("SEAM_API_URL") ?? "https://connect.getseam.com";
const SEAM_API_KEY = Deno.env.get("SEAM_API_KEY") ?? "";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 10_000;

export interface UnlockResult {
  ok: boolean;
  actionAttemptId?: string;
  error?: unknown;
}

async function seamPost(path: string, body: unknown): Promise<Response> {
  return await fetch(`${SEAM_API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SEAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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

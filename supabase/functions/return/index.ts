// POST { session_id: uuid }
// Unlocks the cabinet so the user can put the item back, then marks the
// session returned. If the unlock fails, nothing changes — the user retries.

import { jsonResponse, serviceClient, userClient } from "../_shared/supabase.ts";
import { unlockDoor } from "../_shared/seam.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth?.user) return jsonResponse({ error: "not authenticated" }, 401);

  let body: { session_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (!body.session_id) return jsonResponse({ error: "session_id is required" }, 400);

  // RLS: users only see their own sessions; admins see all.
  const { data: session } = await supa
    .from("borrow_sessions")
    .select("id, status, item_unit_id")
    .eq("id", body.session_id)
    .maybeSingle();
  if (!session) return jsonResponse({ error: "session not found" }, 404);
  if (session.status !== "active") {
    return jsonResponse({ error: "session is not active" }, 409);
  }

  const service = serviceClient();
  const { data: unit } = await service
    .from("item_units")
    .select("cabinet_id")
    .eq("id", session.item_unit_id)
    .single();
  const { data: lock } = await service
    .from("locks")
    .select("id, seam_device_id")
    .eq("cabinet_id", unit?.cabinet_id ?? "")
    .eq("is_active", true)
    .not("seam_device_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (lock) {
    await service.from("device_events").insert({
      lock_id: lock.id,
      borrow_session_id: session.id,
      actor_user_id: auth.user.id,
      event_type: "unlock_requested",
      detail: { purpose: "return" },
    });

    const unlock = await unlockDoor(lock.seam_device_id);

    await service.from("device_events").insert({
      lock_id: lock.id,
      borrow_session_id: session.id,
      actor_user_id: auth.user.id,
      event_type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
      seam_action_attempt_id: unlock.actionAttemptId ?? null,
      detail: unlock.ok ? { purpose: "return" } : { purpose: "return", error: unlock.error },
    });

    if (!unlock.ok) {
      return jsonResponse(
        { error: "cabinet did not unlock — item still checked out, please retry" },
        502,
      );
    }
  }

  // Ownership is enforced again inside the RPC (owner or admin).
  const { error: returnError } = await supa.rpc("mark_returned", {
    p_session_id: session.id,
  });
  if (returnError) return jsonResponse({ error: returnError.message }, 400);

  return jsonResponse({ session_id: session.id, status: "returned" });
});

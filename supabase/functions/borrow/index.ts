// POST { item_type_id: uuid, days?: number }
// Claims a unit (atomic RPC), then unlocks the cabinet via Seam.
// If the unlock fails, the session is cancelled so nothing is stranded.

import { jsonResponse, serviceClient, userClient } from "../_shared/supabase.ts";
import { unlockDoor } from "../_shared/seam.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth?.user) return jsonResponse({ error: "not authenticated" }, 401);

  let body: { item_type_id?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (!body.item_type_id) return jsonResponse({ error: "item_type_id is required" }, 400);

  // 1. Atomically claim a unit and create the session (runs as the user).
  const { data: claimed, error: claimError } = await supa.rpc("borrow_unit", {
    p_item_type_id: body.item_type_id,
    p_days: body.days ?? 7,
  });
  if (claimError) {
    const noneAvailable = claimError.message.includes("no units available");
    return jsonResponse({ error: claimError.message }, noneAvailable ? 409 : 400);
  }
  const session = Array.isArray(claimed) ? claimed[0] : claimed;

  // 2. Find the Seam lock guarding this unit's cabinet (service role: the
  //    locks table is not readable by users).
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

  // No Seam lock paired yet (or unit lives outside a smart cabinet): the
  // checkout still counts; record that the unlock was skipped.
  if (!lock) {
    await service.from("device_events").insert({
      borrow_session_id: session.session_id,
      actor_user_id: auth.user.id,
      event_type: "unlock_requested",
      detail: { skipped: true, reason: "no active Seam lock configured for cabinet" },
    });
    return jsonResponse({ ...session, unlock: "skipped" });
  }

  // 3. Unlock via Seam, with a full audit trail.
  await service.from("device_events").insert({
    lock_id: lock.id,
    borrow_session_id: session.session_id,
    actor_user_id: auth.user.id,
    event_type: "unlock_requested",
    detail: {},
  });

  const unlock = await unlockDoor(lock.seam_device_id);

  await service.from("device_events").insert({
    lock_id: lock.id,
    borrow_session_id: session.session_id,
    actor_user_id: auth.user.id,
    event_type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
    seam_action_attempt_id: unlock.actionAttemptId ?? null,
    detail: unlock.ok ? {} : { error: unlock.error },
  });

  if (!unlock.ok) {
    // Compensate: the user never got the door open, so undo the checkout.
    await service.rpc("cancel_borrow_session", { p_session_id: session.session_id });
    return jsonResponse(
      { error: "cabinet did not unlock — item not checked out, please retry" },
      502,
    );
  }

  return jsonResponse({ ...session, unlock: "ok" });
});

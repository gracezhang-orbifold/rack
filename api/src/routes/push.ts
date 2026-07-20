import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";

// Browser push subscriptions. A user can hold one per browser/device; the
// endpoint is the identity, so re-subscribing the same browser upserts.
export async function pushRoutes(app: FastifyInstance) {
  app.post<{ Body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(
    "/api/push/subscriptions", { preHandler: requireUser }, async (req, reply) => {
      const { endpoint, keys } = req.body ?? {};
      if (typeof endpoint !== "string" || !endpoint
        || typeof keys?.p256dh !== "string" || !keys.p256dh
        || typeof keys?.auth !== "string" || !keys.auth)
        return reply.code(400).send({ error: "endpoint and keys (p256dh, auth) are required" });
      await query(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
         values ($1, $2, $3, $4)
         on conflict (endpoint) do update
           set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
        [req.user!.id, endpoint, keys.p256dh, keys.auth]);
      return { ok: true };
    });

  app.delete<{ Body: { endpoint?: string } }>(
    "/api/push/subscriptions", { preHandler: requireUser }, async (req, reply) => {
      const { endpoint } = req.body ?? {};
      if (typeof endpoint !== "string" || !endpoint)
        return reply.code(400).send({ error: "endpoint is required" });
      await query(`delete from push_subscriptions where endpoint = $1 and user_id = $2`,
        [endpoint, req.user!.id]);
      return { ok: true };
    });
}

// Web-push delivery. Push is optional infrastructure: without VAPID keys in
// the environment every helper degrades gracefully, so email stays the
// reminder channel of last resort.

import webpush from "web-push";
import { env } from "./env.js";
import { query } from "./db.js";

// Read lazily (like seam.ts) so tests can set the keys after env.ts loads.
const vapidPublic = () => process.env.VAPID_PUBLIC_KEY ?? env.VAPID_PUBLIC_KEY;
const vapidPrivate = () => process.env.VAPID_PRIVATE_KEY ?? env.VAPID_PRIVATE_KEY;
const vapidSubject = () => process.env.VAPID_SUBJECT ?? env.VAPID_SUBJECT;

export const pushEnabled = () => Boolean(vapidPublic() && vapidPrivate());
export const pushPublicKey = () => (pushEnabled() ? vapidPublic() : "");

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// Send to every subscription the user has, pruning dead ones (404/410 means
// the push service revoked that browser's subscription). Returns true if at
// least one delivery succeeded.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<boolean> {
  if (!pushEnabled()) return false;
  webpush.setVapidDetails(vapidSubject(), vapidPublic(), vapidPrivate());
  const { rows: subs } = await query(
    `select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1`, [userId]);
  let delivered = false;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload));
      delivered = true;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await query(`delete from push_subscriptions where id = $1`, [s.id]);
      } else {
        console.error("push delivery failed for user", userId, status ?? err);
      }
    }
  }
  return delivered;
}

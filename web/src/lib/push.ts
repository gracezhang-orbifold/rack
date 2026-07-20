// Browser push support helpers. On desktop and Android the Push API is
// available in the plain browser; on iOS Safari it only exists inside a
// PWA installed to the Home Screen (iOS 16.4+) — so feature detection is
// also the "installed app only" gate.

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches
  || (navigator as { standalone?: boolean }).standalone === true;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Ask permission and subscribe this browser. Throws with a user-showable
// message when the user blocks notifications.
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJson> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("notifications are blocked — allow them for this site and try again");
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    throw new Error("couldn't create a push subscription");
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

// Rack service worker: web push display + click-through. No offline caching —
// the app stays network-served; this worker exists so the browser can receive
// push messages (and so iOS treats the installed app as push-capable).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON push */ }
  event.waitUntil(self.registration.showNotification(data.title || "Rack", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ("focus" in client) { client.navigate(url); return client.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});

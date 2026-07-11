/* TaskFocus service worker: push delivery only; intentionally no fetch cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = payload.title || "TaskFocus";
  const options = {
    body: payload.body || "A task needs your attention.",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    tag: String(payload.nid || "taskfocus-reminder"),
    data: { url: payload.url || "./#tasks" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification.data?.url || "./#tasks";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(destination);
      return;
    }
    await self.clients.openWindow(destination);
  })());
});

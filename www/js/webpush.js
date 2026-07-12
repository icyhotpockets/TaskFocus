import { planNotifications } from "./core/notifications.js";

const DEVICE_KEY = "taskfocus.push.device-id";
let configPromise = null;

function supportsWebPush() {
  return "Notification" in globalThis
    && "serviceWorker" in navigator
    && "PushManager" in globalThis;
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function fromBase64Url(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(`${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function loadConfig() {
  if (!configPromise) {
    configPromise = fetch(`./push-config.json?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : {})
      .then((config) => ({
        workerUrl: String(config.workerUrl || "").replace(/\/$/, ""),
        vapidPublicKey: String(config.vapidPublicKey || ""),
      }))
      .catch(() => ({ workerUrl: "", vapidPublicKey: "" }));
  }
  return configPromise;
}

async function post(path, body) {
  const config = await loadConfig();
  if (!config.workerUrl) throw new Error("iPhone push server is not configured yet.");
  const response = await fetch(`${config.workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Push server returned ${response.status}.`);
  return response.json().catch(() => ({}));
}

async function currentSubscription() {
  if (!supportsWebPush()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function getWebPushStatus() {
  const config = await loadConfig();
  const permission = supportsWebPush() ? Notification.permission : "unavailable";
  const subscription = permission === "granted" ? await currentSubscription().catch(() => null) : null;
  return {
    supported: supportsWebPush(),
    permission,
    exact: "unavailable",
    pending: 0,
    configured: Boolean(config.workerUrl && config.vapidPublicKey),
    subscribed: Boolean(subscription),
  };
}

export async function enableWebPush(data) {
  if (!supportsWebPush()) throw new Error("Install TaskFocus with Safari → Add to Home Screen before enabling iPhone push.");

  // This must be the first asynchronous browser operation in the user's tap.
  const permissionPromise = Notification.requestPermission();
  const permission = await permissionPromise;
  if (permission !== "granted") return permission;

  const config = await loadConfig();
  if (!config.workerUrl || !config.vapidPublicKey) throw new Error("iPhone push server setup is not complete.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(config.vapidPublicKey),
    });
  }
  await post("/subscribe", { deviceId: deviceId(), subscription: subscription.toJSON() });
  await syncWebPush(data, subscription);
  return permission;
}

export async function syncWebPush(data, suppliedSubscription = null) {
  if (!supportsWebPush() || Notification.permission !== "granted") return { synced: false };
  const subscription = suppliedSubscription || await currentSubscription();
  if (!subscription) return { synced: false };
  const rows = planNotifications(data.tasks, data.settings, Date.now()).map((row) => ({
    nid: row.nid,
    fireAt: row.fireAt,
    title: row.title,
    body: row.body,
    url: "./#tasks",
  }));
  await post("/sync", { deviceId: deviceId(), rows });
  return { synced: true, count: rows.length };
}

export async function testWebPush() {
  if (!supportsWebPush() || Notification.permission !== "granted") {
    throw new Error("Enable iPhone notifications first.");
  }
  await post("/test", { deviceId: deviceId() });
  return true;
}

export async function unsubscribeWebPush() {
  const subscription = await currentSubscription();
  if (subscription) await subscription.unsubscribe();
  await post("/unsubscribe", { deviceId: deviceId() });
}

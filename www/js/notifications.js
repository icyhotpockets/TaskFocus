import { isNative, nativePlugin } from "./native.js";
import { planNotifications, TEST_NOTIFICATION_ID } from "./core/notifications.js";

export const NOTIFICATION_CHANNEL_ID = "taskfocus-reminders-v1";
export const ACTION_TYPE_NAG = "taskfocus-nag";
export const ACTION_TYPE_DUE = "taskfocus-due";

let listenersConfigured = false;

function localNotifications() {
  return nativePlugin("LocalNotifications");
}

function actionTypeForRow(row) {
  if (row.kind === "nag") return ACTION_TYPE_NAG;
  if (row.kind === "due") return ACTION_TYPE_DUE;
  return undefined;
}

export function nativeNotificationFromRow(row) {
  const actionTypeId = actionTypeForRow(row);
  return {
    id: row.nid,
    title: row.title,
    body: row.body,
    largeBody: row.body,
    channelId: NOTIFICATION_CHANNEL_ID,
    ...(actionTypeId ? { actionTypeId } : {}),
    schedule: {
      at: new Date(row.fireAt),
      allowWhileIdle: true,
    },
    autoCancel: true,
    extra: {
      taskId: row.taskId,
      kind: row.kind,
      slot: row.slot,
    },
  };
}

export function buildNativeSchedule(data, now = Date.now()) {
  return planNotifications(data.tasks, data.settings, now).map(nativeNotificationFromRow);
}

export function taskIdFromNotificationAction(action) {
  const taskId = Number(action?.notification?.extra?.taskId);
  if (Number.isInteger(taskId) && taskId > 0) return taskId;
  const notificationId = Number(action?.notification?.id);
  if (!Number.isInteger(notificationId) || notificationId === TEST_NOTIFICATION_ID) return null;
  const inferred = Math.floor(notificationId / 100);
  return inferred > 0 ? inferred : null;
}

export async function configureNativeNotifications({ onAction, onResume } = {}) {
  if (!isNative) return false;
  const plugin = localNotifications();
  if (!plugin) throw new Error("Android notification bridge is unavailable.");

  await plugin.registerActionTypes({
    types: [
      {
        id: ACTION_TYPE_NAG,
        actions: [
          { id: "done", title: "✓ Done", foreground: true },
          { id: "snooze", title: "Snooze 1h", foreground: true },
        ],
      },
      {
        id: ACTION_TYPE_DUE,
        actions: [{ id: "done", title: "✓ Done", foreground: true }],
      },
    ],
  });

  try {
    await plugin.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: "Task reminders",
      description: "Due alerts, interval reminders, and focus-session events",
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: "#C4576A",
    });
  } catch {
    // Android versions before notification channels report this as unavailable.
  }

  if (!listenersConfigured) {
    if (onAction) await plugin.addListener("localNotificationActionPerformed", onAction);
    const app = nativePlugin("App");
    if (onResume && app?.addListener) await app.addListener("resume", onResume);
    listenersConfigured = true;
  }
  return true;
}

export async function getNativeNotificationStatus() {
  if (!isNative) {
    return { supported: false, permission: "unavailable", exact: "unavailable", pending: 0 };
  }
  const plugin = localNotifications();
  if (!plugin) {
    return { supported: false, permission: "unavailable", exact: "unavailable", pending: 0 };
  }
  const [permission, exact, pending] = await Promise.all([
    plugin.checkPermissions(),
    plugin.checkExactNotificationSetting().catch(() => ({ exact_alarm: "granted" })),
    plugin.getPending(),
  ]);
  return {
    supported: true,
    permission: permission.display,
    exact: exact.exact_alarm,
    pending: pending.notifications.length,
  };
}

export async function requestNativeNotificationPermission() {
  if (!isNative || !localNotifications()) return "unavailable";
  const result = await localNotifications().requestPermissions();
  return result.display;
}

export async function openExactAlarmSettings() {
  if (!isNative || !localNotifications()) return "unavailable";
  const result = await localNotifications().changeExactNotificationSetting();
  return result.exact_alarm;
}

export async function reconcileNativeNotifications(data, now = Date.now()) {
  if (!isNative || !localNotifications()) return { scheduled: 0, skipped: true };
  const plugin = localNotifications();
  const permission = await plugin.checkPermissions();
  if (permission.display !== "granted") return { scheduled: 0, skipped: true };

  const pending = await plugin.getPending();
  const cancellable = pending.notifications
    .filter(({ id }) => id !== TEST_NOTIFICATION_ID)
    .map(({ id }) => ({ id }));
  if (cancellable.length) await plugin.cancel({ notifications: cancellable });

  const notifications = buildNativeSchedule(data, now);
  if (notifications.length) await plugin.schedule({ notifications });
  return { scheduled: notifications.length, skipped: false };
}

export async function scheduleNativeTestNotification(now = Date.now()) {
  if (!isNative || !localNotifications()) throw new Error("Android notifications are unavailable.");
  const at = new Date(now + 2 * 60_000);
  await localNotifications().schedule({
    notifications: [{
      id: TEST_NOTIFICATION_ID,
      title: "TaskFocus test",
      body: "Notifications are working.",
      largeBody: "Notifications are working. TaskFocus can remind you while the app is closed.",
      channelId: NOTIFICATION_CHANNEL_ID,
      schedule: { at, allowWhileIdle: true },
      autoCancel: true,
      extra: { kind: "test" },
    }],
  });
  return at.getTime();
}

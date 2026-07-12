import {
  deserializeVapidKeys,
  fromBase64Url,
  sendPushNotification,
  toBase64Url,
} from "./webpush.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
let vapidKeysPromise = null;
let storageKeyPromise = null;

async function storageKey(env) {
  if (!storageKeyPromise) {
    storageKeyPromise = crypto.subtle.digest("SHA-256", new TextEncoder().encode(`taskfocus-storage:${env.VAPID_PRIVATE_KEY}`))
      .then((bytes) => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  return storageKeyPromise;
}

async function encryptStoredPayload(env, value) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await storageKey(env), plaintext);
  return toBase64Url(new Uint8Array([...nonce, ...new Uint8Array(ciphertext)]));
}

async function decryptStoredPayload(env, value) {
  const bytes = fromBase64Url(value);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await storageKey(env), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function response(request, env, body, status = 200) {
  const origin = request.headers.get("origin") || "";
  const allowed = origin === env.ALLOWED_ORIGIN || origin === `${env.ALLOWED_ORIGIN}/`;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-origin": allowed ? origin : env.ALLOWED_ORIGIN,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      vary: "origin",
    },
  });
}

function validDeviceId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

function validSubscription(value) {
  return value && typeof value === "object"
    && typeof value.endpoint === "string" && value.endpoint.startsWith("https://")
    && typeof value.keys?.auth === "string" && typeof value.keys?.p256dh === "string";
}

async function bodyJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 250_000) throw new Error("Request is too large.");
  return request.json();
}

async function writeLog(env, kind, message) {
  const clipped = String(message).slice(0, 500);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO logs (at, kind, message) VALUES (?, ?, ?)").bind(Date.now(), kind, clipped),
    env.DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 200)"),
  ]);
}

async function subscribe(request, env) {
  const input = await bodyJson(request);
  if (!validDeviceId(input.deviceId) || !validSubscription(input.subscription)) {
    return response(request, env, { error: "Invalid subscription." }, 400);
  }
  await env.DB.prepare(`
    INSERT INTO subscriptions (device_id, subscription, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET subscription=excluded.subscription, updated_at=excluded.updated_at
  `).bind(input.deviceId, JSON.stringify(input.subscription), Date.now()).run();
  await writeLog(env, "subscribe", `dev=${input.deviceId.slice(0, 8)}`);
  return response(request, env, { ok: true });
}

async function sync(request, env) {
  const input = await bodyJson(request);
  if (!validDeviceId(input.deviceId) || !Array.isArray(input.rows) || input.rows.length > 220) {
    return response(request, env, { error: "Invalid schedule." }, 400);
  }
  const rows = input.rows.filter((row) => Number.isInteger(row.nid)
    && Number.isFinite(row.fireAt) && row.fireAt > Date.now() - 60_000
    && typeof row.title === "string" && typeof row.body === "string");
  const statements = [env.DB.prepare("DELETE FROM pending WHERE device_id = ?").bind(input.deviceId)];
  for (const row of rows) {
    const payload = await encryptStoredPayload(env, {
      title: row.title.slice(0, 120),
      body: row.body.slice(0, 240),
      url: typeof row.url === "string" ? row.url.slice(0, 200) : "./#tasks",
    });
    statements.push(env.DB.prepare(`
      INSERT INTO pending (device_id, nid, fire_at, payload) VALUES (?, ?, ?, ?)
    `).bind(
      input.deviceId,
      row.nid,
      Math.trunc(row.fireAt),
      payload,
    ));
  }
  await env.DB.batch(statements);
  const due = rows.filter((row) => row.fireAt <= Date.now() + 5 * 60_000).length;
  await writeLog(env, "sync", `dev=${input.deviceId.slice(0, 8)} rows=${rows.length} due=${due}`);
  return response(request, env, { ok: true, rows: rows.length });
}

async function unsubscribe(request, env) {
  const input = await bodyJson(request);
  if (!validDeviceId(input.deviceId)) return response(request, env, { error: "Invalid device." }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pending WHERE device_id = ?").bind(input.deviceId),
    env.DB.prepare("DELETE FROM subscriptions WHERE device_id = ?").bind(input.deviceId),
  ]);
  await writeLog(env, "unsubscribe", `dev=${input.deviceId.slice(0, 8)}`);
  return response(request, env, { ok: true });
}

async function test(request, env) {
  const input = await bodyJson(request);
  if (!validDeviceId(input.deviceId)) return response(request, env, { error: "Invalid device." }, 400);
  const subscription = await env.DB.prepare("SELECT device_id FROM subscriptions WHERE device_id = ?").bind(input.deviceId).first();
  if (!subscription) return response(request, env, { error: "Subscribe first." }, 404);
  const payload = await encryptStoredPayload(env, { title: "TaskFocus test", body: "Notifications are working.", url: "./#settings" });
  await env.DB.prepare(`
    INSERT INTO pending (device_id, nid, fire_at, payload) VALUES (?, 999001, ?, ?)
    ON CONFLICT(device_id, nid) DO UPDATE SET fire_at=excluded.fire_at, payload=excluded.payload
  `).bind(input.deviceId, Date.now() + 120_000, payload).run();
  await writeLog(env, "test", `dev=${input.deviceId.slice(0, 8)} +2m`);
  return response(request, env, { ok: true, fireAt: Date.now() + 120_000 });
}

async function status(request, env) {
  const [subscriptions, pending, next, logs] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM subscriptions").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM pending").first(),
    env.DB.prepare("SELECT fire_at FROM pending ORDER BY fire_at LIMIT 1").first(),
    env.DB.prepare("SELECT at, kind, message FROM logs ORDER BY id DESC LIMIT 30").all(),
  ]);
  return response(request, env, {
    ok: true,
    subscriptions: Number(subscriptions?.count || 0),
    pending: Number(pending?.count || 0),
    next: next || null,
    recent: logs.results || [],
  });
}

async function keys(env) {
  if (!vapidKeysPromise) {
    vapidKeysPromise = deserializeVapidKeys({
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
  }
  return vapidKeysPromise;
}

async function sendDue(env) {
  const due = await env.DB.prepare(`
    SELECT p.device_id, p.nid, p.payload, s.subscription
    FROM pending p JOIN subscriptions s ON s.device_id = p.device_id
    WHERE p.fire_at <= ? ORDER BY p.fire_at LIMIT 100
  `).bind(Date.now()).all();
  for (const row of due.results || []) {
    let statusCode = 0;
    try {
      const subscription = JSON.parse(row.subscription);
      const payload = await decryptStoredPayload(env, row.payload);
      const result = await sendPushNotification(
        await keys(env),
        subscription,
        env.VAPID_SUBJECT,
        JSON.stringify({ nid: row.nid, title: payload.title, body: payload.body, url: payload.url }),
        { algorithm: "aes128gcm" },
      );
      statusCode = result.status;
      if (result.status === 404 || result.status === 410) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM pending WHERE device_id = ?").bind(row.device_id),
          env.DB.prepare("DELETE FROM subscriptions WHERE device_id = ?").bind(row.device_id),
        ]);
      }
    } catch (error) {
      await writeLog(env, "send-error", `dev=${row.device_id.slice(0, 8)} nid=${row.nid} ${error instanceof Error ? error.message : error}`);
    } finally {
      await env.DB.prepare("DELETE FROM pending WHERE device_id = ? AND nid = ?").bind(row.device_id, row.nid).run();
      await writeLog(env, "send", `dev=${row.device_id.slice(0, 8)} nid=${row.nid} http=${statusCode}`);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return response(request, env, { ok: true });
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && path === "/status") return status(request, env);
      if (request.method === "POST" && path === "/subscribe") return subscribe(request, env);
      if (request.method === "POST" && path === "/sync") return sync(request, env);
      if (request.method === "POST" && path === "/unsubscribe") return unsubscribe(request, env);
      if (request.method === "POST" && path === "/test") return test(request, env);
      return response(request, env, { error: "Not found." }, 404);
    } catch (error) {
      await writeLog(env, "request-error", error instanceof Error ? error.message : error).catch(() => undefined);
      return response(request, env, { error: "Request failed." }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};

export { sendDue };

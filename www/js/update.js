import { isNative } from "./native.js";

export const RELEASE_PAGE_URL = "https://github.com/icyhotpockets/TaskFocus/releases/tag/latest";
export const PUBLISHED_VERSION_URL = "https://icyhotpockets.github.io/TaskFocus/version.json";

function capacitorAppPlugin() {
  return globalThis.Capacitor?.Plugins?.App ?? null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function installedBuildNumber() {
  if (!isNative) return null;
  const app = capacitorAppPlugin();
  if (!app?.getInfo) return null;
  try {
    const info = await app.getInfo();
    return positiveInteger(info.build);
  } catch {
    return null;
  }
}

export async function checkForNativeUpdate({
  versionUrl = PUBLISHED_VERSION_URL,
  releaseUrl = RELEASE_PAGE_URL,
} = {}) {
  if (!isNative) return null;

  const installed = await installedBuildNumber();
  if (!installed) return null;

  try {
    const response = await fetch(`${versionUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const published = await response.json();
    const latest = positiveInteger(published.versionCode);
    if (!latest) return null;
    return {
      available: latest > installed,
      installed,
      latest,
      versionName: String(published.versionName || `1.0.${latest}`),
      releaseUrl,
    };
  } catch {
    return null;
  }
}

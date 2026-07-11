function capacitorRuntime() {
  return globalThis.Capacitor || globalThis.window?.Capacitor || null;
}

export const isNative = Boolean(capacitorRuntime()?.isNativePlatform?.());

export function nativePlugin(name) {
  return isNative ? capacitorRuntime()?.Plugins?.[name] || null : null;
}

export function platformName() {
  if (isNative) {
    const platform = capacitorRuntime()?.getPlatform?.();
    return platform === "android" ? "Android native" : `${platform || "Native"} app`;
  }

  const standalone = globalThis.matchMedia?.("(display-mode: standalone)")?.matches
    || globalThis.navigator?.standalone === true;
  return standalone ? "Installed web app" : "Web preview";
}

export function hapticTick() {
  const haptics = capacitorRuntime()?.Plugins?.Haptics;
  if (haptics?.impact) {
    return haptics.impact({ style: "LIGHT" }).catch(() => undefined);
  }
  globalThis.navigator?.vibrate?.(15);
  return Promise.resolve();
}

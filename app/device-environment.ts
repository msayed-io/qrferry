import {
  NativeDevice,
  isNativeDevice,
  type DevicePreferences,
} from "@/lib/native-device";
import { deviceLanguage } from "./device-language";

let nativePreferences: DevicePreferences | null = null;
const listeners = new Set<() => void>();
export function currentDeviceLanguage() {
  return deviceLanguage(
    nativePreferences?.languages ??
      (typeof navigator === "undefined" ? [] : navigator.languages),
  );
}
export function subscribeDeviceLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function apply(value: DevicePreferences) {
  if (
    nativePreferences?.dark === value.dark &&
    nativePreferences.languages.join() === value.languages.join()
  )
    return;
  nativePreferences = value;
  const language = deviceLanguage(value.languages);
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.theme = value.dark ? "dark" : "light";
  document.documentElement.style.colorScheme = value.dark ? "dark" : "light";
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new Event("qrferry-device-preferences"));
}
/** Native OS configuration is authoritative, not a stored theme/language toggle. */
export async function initializeDeviceEnvironment() {
  if (!isNativeDevice()) return;
  document.documentElement.dataset.native = "";
  await NativeDevice.addListener("preferencesChanged", apply);
  const refresh = () => NativeDevice.getPreferences().then(apply);
  await refresh();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh().catch(console.warn);
  });
}

import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";

export type DevicePreferences = { dark: boolean; languages: string[] };
export type NativeSharedFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
};
interface DevicePlugin {
  getPreferences(): Promise<DevicePreferences>;
  addListener(
    name: "preferencesChanged",
    callback: (value: DevicePreferences) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    name: "sharedFiles",
    callback: () => void,
  ): Promise<PluginListenerHandle>;
  getSharedFiles(): Promise<{ files: NativeSharedFile[] }>;
  readSharedChunk(options: {
    id: string;
    offset: number;
    length: number;
  }): Promise<{ data: string }>;
  clearSharedFiles(options: { ids: string[] }): Promise<void>;
  beginSave(options: {
    name: string;
    mime: string;
  }): Promise<{ id: string; cancelled?: boolean }>;
  writeSaveChunk(options: { id: string; data: string }): Promise<void>;
  finishSave(options: { id: string; abort?: boolean }): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  notify(options: { title: string; body: string }): Promise<void>;
  setAwake(options: { awake: boolean }): Promise<void>;
}
export const NativeDevice = registerPlugin<DevicePlugin>("QRFerryDevice");
export const isNativeDevice = () => Capacitor.isNativePlatform();

export async function saveNativeFile(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<"saved" | "cancelled"> {
  const result = await NativeDevice.beginSave({ name, mime });
  if (result.cancelled) return "cancelled";
  try {
    for (let offset = 0; offset < bytes.length; offset += 196608) {
      const chunk = bytes.subarray(offset, offset + 196608);
      let binary = "";
      for (let i = 0; i < chunk.length; i += 8192)
        binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
      await NativeDevice.writeSaveChunk({ id: result.id, data: btoa(binary) });
    }
    await NativeDevice.finishSave({ id: result.id });
    return "saved";
  } catch (error) {
    await NativeDevice.finishSave({ id: result.id, abort: true }).catch(
      () => {},
    );
    throw error;
  }
}
let wakeOwners = 0;
export async function acquireNativeWakeLock() {
  wakeOwners++;
  try {
    await NativeDevice.setAwake({ awake: true });
  } catch (error) {
    wakeOwners--;
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    wakeOwners = Math.max(0, wakeOwners - 1);
    if (!wakeOwners) await NativeDevice.setAwake({ awake: false });
  };
}

/** Packaged localhost is not a shareable web address. The verified production
 * origin is used only in exported links; no Android assets are loaded from it. */
export function applicationShareOrigin() {
  return isNativeDevice()
    ? import.meta.env.VITE_PUBLIC_APP_ORIGIN || "https://qrferry-io.vercel.app"
    : location.origin;
}

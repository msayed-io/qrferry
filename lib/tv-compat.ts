/**
 * فحص توافق التلفزيون/الجهاز مع وضع الاستقبال:
 * يكتشف فوراً إمكانيات المتصفح (WebRTC، التحميل، تشغيل الوسائط)
 * ويوجّه المستخدم للبديل إن لزم — بدل إضاعة الوقت.
 */

export type TvCompatibility = {
  webRtc: boolean;
  webSocket: boolean;
  download: boolean;
  mediaPlayback: boolean;
  indexedDb: boolean;
};

export function checkTvCompatibility(): TvCompatibility {
  const anchor = document.createElement("a");
  return {
    webRtc: typeof window.RTCPeerConnection !== "undefined",
    webSocket: typeof window.WebSocket !== "undefined",
    download: "download" in anchor,
    mediaPlayback:
      typeof window.HTMLVideoElement !== "undefined" &&
      typeof window.HTMLAudioElement !== "undefined",
    indexedDb: typeof indexedDB !== "undefined",
  };
}

export function tvCompatibilitySummary(compat: TvCompatibility): {
  canReceive: boolean;
  limitations: string[];
} {
  const limitations: string[] = [];
  if (!compat.webRtc) limitations.push("webRtc");
  if (!compat.webSocket) limitations.push("webSocket");
  if (!compat.download) limitations.push("download");
  if (!compat.indexedDb) limitations.push("indexedDb");
  const canReceive = compat.webRtc && compat.webSocket && compat.download;
  return { canReceive, limitations };
}

/** يوزّع عنوان خادم تسيير (ws://host:port/path) إلى إعداد PeerJS. */
export function parsePeerServerUrl(value: string): {
  host: string;
  port: number;
  path: string;
  secure: boolean;
} | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    const port = url.port ? Number(url.port) : url.protocol === "wss:" ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      host: url.hostname,
      port,
      path: url.pathname || "/",
      secure: url.protocol === "wss:",
    };
  } catch {
    return null;
  }
}

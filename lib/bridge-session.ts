/**
 * طبقة اتصال جسر QRFerry فوق PeerJS.
 *
 *  - openBridgeHost(): الكمبيوتر (أو أي جهاز) يُنشئ peer ويعرض رمز الربط،
 *    ويقبل اتصالاً واحداً في كل لحظة. بعد 5 محاولات فاشلة يُقفل حتى يُنشأ رمز جديد.
 *  - joinBridge(): الجهاز الآخر يمسح الرمز ويتصل بالمضيف باستخدام خادم الإشارة المكتوب فيه.
 *
 * ملاحظة: بيانات الملفات والرسائل لا تمر بخادم الإشارة أبداً — تمر عبر قناة
 * WebRTC المشفّرة (DTLS) بين الجهازين. خادم الإشارة يرى فقط معرّفات الـ peers.
 */

import {
  BridgeChannel,
  type BridgeCallbacks,
  type BridgeConnectionLike,
  type BridgeOutgoingFile,
} from "./bridge-channel";
import { generateBridgeSecret, importBridgeKey } from "./bridge-auth";
import {
  encodeBridgePairing,
  type BridgePairing,
  type BridgeServer,
} from "./bridge-pairing";
import { getPeerServerConfig } from "./fast-transfer";

export const BRIDGE_MAX_FAILED_ATTEMPTS = 5;
const PEER_OPEN_TIMEOUT_MS = 20_000;

export type BridgeHostState =
  | "starting"
  | "waiting"
  | "connected"
  | "locked"
  | "error";

export type BridgeHostCallbacks = BridgeCallbacks & {
  onHostState(state: BridgeHostState, detail?: string): void;
};

export type BridgeHandle = {
  /** يعيد true إذا كانت القناة مصادقة وجاهزة للإرسال. */
  isReady(): boolean;
  sendChat(text: string): void;
  sendFile(file: BridgeOutgoingFile): void;
  destroy(): void;
};

export type BridgeHostHandle = BridgeHandle & {
  peerId: string;
  secret: string;
  server: BridgeServer;
  /** النص الخام للرمز (يُنسخ ويُلصق يدوياً إن تعذّر المسح). */
  payload: string;
};

type PeerLike = {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  connect(id: string, options: Record<string, unknown>): unknown;
  destroy(): void;
};

type PeerConstructor = new (options: Record<string, unknown>) => PeerLike;

async function loadPeer(): Promise<PeerConstructor> {
  const peerModule = await import("peerjs");
  return peerModule.default as unknown as PeerConstructor;
}

function peerOptions(server: BridgeServer): Record<string, unknown> {
  return {
    host: server.host,
    port: server.port,
    path: server.path,
    secure: server.secure,
    debug: 0,
  };
}

function waitForPeerOpen(peer: PeerLike): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("تعذّر الاتصال بخادم الإشارة. تحقق من الشبكة."));
    }, PEER_OPEN_TIMEOUT_MS);
    peer.on("open", (id: unknown) => {
      clearTimeout(timer);
      resolve(String(id));
    });
    peer.on("error", (error: unknown) => {
      clearTimeout(timer);
      reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  });
}

function rejectConnection(conn: BridgeConnectionLike, reason: "busy" | "denied") {
  const send = () => {
    try {
      conn.send(JSON.stringify({ t: reason === "busy" ? "busy" : "denied" }));
    } catch {
      // الاتصال غير متاح.
    }
    setTimeout(() => {
      try {
        conn.close();
      } catch {
        // مغلق مسبقاً.
      }
    }, 400);
  };
  if (conn.open) send();
  else conn.on("open", send);
}

export async function openBridgeHost(
  callbacks: BridgeHostCallbacks,
): Promise<BridgeHostHandle> {
  const Peer = await loadPeer();
  const server = getPeerServerConfig();
  const secret = generateBridgeSecret();
  const key = await importBridgeKey(secret);
  const peer = new Peer(peerOptions(server));
  let destroyed = false;
  let locked = false;
  let failedAttempts = 0;
  let active: BridgeChannel | null = null;

  let peerId: string;
  try {
    peerId = await waitForPeerOpen(peer);
  } catch (error) {
    try {
      peer.destroy();
    } catch {
      // تجاهل
    }
    throw error;
  }

  const pairing: BridgePairing = { peerId, secret, server };
  const payload = encodeBridgePairing(pairing);

  const hostCallbacks = (channel: { current: BridgeChannel | null }): BridgeCallbacks => ({
    onStatus(status, detail) {
      if (status === "authenticating") {
        callbacks.onHostState("waiting", "جارٍ التحقق من الجهاز الآخر…");
      }
      if (status === "connected") {
        callbacks.onHostState("connected");
      }
      if (status === "denied") {
        failedAttempts += 1;
        if (failedAttempts >= BRIDGE_MAX_FAILED_ATTEMPTS) {
          locked = true;
        }
      }
      if (status === "closed" || status === "failed" || status === "denied") {
        if (active === channel.current) active = null;
        if (locked) {
          callbacks.onHostState("locked", "تم إيقاف الاستماع بعد محاولات فاشلة متكررة.");
        } else if (!destroyed) {
          callbacks.onHostState("waiting", detail);
        }
      }
      callbacks.onStatus(status, detail);
    },
    onChat: callbacks.onChat,
    onFile: callbacks.onFile,
  });

  peer.on("connection", (raw: unknown) => {
    const conn = raw as BridgeConnectionLike;
    if (destroyed || locked) {
      rejectConnection(conn, "denied");
      return;
    }
    if (active && !active.isClosed) {
      rejectConnection(conn, "busy");
      return;
    }
    const holder: { current: BridgeChannel | null } = { current: null };
    const channel = new BridgeChannel(conn, "host", key, hostCallbacks(holder));
    holder.current = channel;
    active = channel;
  });

  peer.on("error", (error: unknown) => {
    if (destroyed) return;
    callbacks.onHostState(
      "error",
      error instanceof Error ? error.message : "خطأ في خادم الإشارة.",
    );
  });

  return {
    peerId,
    secret,
    server,
    payload,
    isReady: () => active?.isReady ?? false,
    sendChat(text: string) {
      if (!active || !active.isReady) throw new Error("لا يوجد جهاز متصل.");
      active.sendChat(text);
    },
    sendFile(file: BridgeOutgoingFile) {
      if (!active || !active.isReady) throw new Error("لا يوجد جهاز متصل.");
      active.sendFile(file);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      active?.close("أغلق الكمبيوتر الجلسة.");
      active = null;
      try {
        peer.destroy();
      } catch {
        // تجاهل
      }
    },
  };
}

export async function joinBridge(
  pairing: BridgePairing,
  callbacks: BridgeCallbacks,
): Promise<BridgeHandle> {
  const Peer = await loadPeer();
  const key = await importBridgeKey(pairing.secret);
  const peer = new Peer(peerOptions(pairing.server));
  try {
    await waitForPeerOpen(peer);
  } catch (error) {
    try {
      peer.destroy();
    } catch {
      // تجاهل
    }
    throw error;
  }

  const conn = peer.connect(pairing.peerId, {
    serialization: "binary",
    reliable: true,
  }) as unknown as BridgeConnectionLike;
  const channel = new BridgeChannel(conn, "joiner", key, callbacks);

  peer.on("error", (error: unknown) => {
    if (channel.isReady || channel.isClosed) return;
    const message =
      error instanceof Error && /peer-unavailable|Could not connect/i.test(error.message)
        ? "الكمبيوتر غير متاح الآن. تأكد أن صفحة الكمبيوتر ما زالت مفتوحة."
        : error instanceof Error
          ? error.message
          : "تعذّر الاتصال بالكمبيوتر.";
    channel.abort(message);
  });

  return {
    isReady: () => channel.isReady,
    sendChat: (text: string) => channel.sendChat(text),
    sendFile: (file: BridgeOutgoingFile) => {
      channel.sendFile(file);
    },
    destroy() {
      channel.close("أغلقت الجلسة.");
      try {
        peer.destroy();
      } catch {
        // تجاهل
      }
    },
  };
}

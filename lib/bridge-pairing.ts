/**
 * رمز ربط جسر QRFerry (QFB1).
 *
 * يعرض الكمبيوتر (المضيف) QR يحمل رابطاً ينتهي بالمسار `/pc` وبياناته في الجزء
 * (#fragment) — فلا يصل الجزء أبداً إلى الخادم في طلبات HTTP:
 *
 *   https://<موقعك>/pc#QFB1.<base64url(JSON)>
 *
 * حمولة JSON قصيرة المفاتيح لتصغير QR:
 *   v: إصدار (1)      p: معرّف الـ peer     s: الرمز السري (22 حرف)
 *   h: مضيف خادم الإشارة   o: المنفذ   r: المسار   t: 1 إذا كان آمناً (wss)
 *
 * الهاتف الذي يمسح الرمز يستخدم خادم الإشارة نفسه المكتوب في الرمز، فلا يحتاج
 * إعداداً يدوياً (مهم للشبكات المعزولة مع خادم محلي).
 */

import {
  base64UrlDecode,
  base64UrlEncode,
  BRIDGE_SECRET_PATTERN,
} from "./bridge-auth";

export const BRIDGE_PREFIX = "QFB1.";
export const BRIDGE_PATH = "/pc";
export const BRIDGE_MAX_PAYLOAD_CHARS = 1024;

export type BridgeServer = {
  host: string;
  port: number;
  path: string;
  secure: boolean;
};

export type BridgePairing = {
  peerId: string;
  secret: string;
  server: BridgeServer;
};

type WirePairing = {
  v: 1;
  p: string;
  s: string;
  h: string;
  o: number;
  r: string;
  t: 0 | 1;
};

const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9._~/-]{0,200}$/;
/** يلتقط الحمولة فقط عند بداية النص أو بعد `#` في رابط كامل. */
const PAYLOAD_PATTERN = /(?:^|#)QFB1\.([A-Za-z0-9_-]{1,1400})$/;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function validatePairing(value: unknown): BridgePairing | null {
  if (!value || typeof value !== "object") return null;
  const wire = value as Partial<WirePairing>;
  if (wire.v !== 1) return null;
  if (typeof wire.p !== "string" || !PEER_ID_PATTERN.test(wire.p)) return null;
  if (typeof wire.s !== "string" || !BRIDGE_SECRET_PATTERN.test(wire.s)) {
    return null;
  }
  if (typeof wire.h !== "string" || !HOST_PATTERN.test(wire.h)) return null;
  if (
    typeof wire.o !== "number" ||
    !Number.isInteger(wire.o) ||
    wire.o < 1 ||
    wire.o > 65535
  ) {
    return null;
  }
  if (
    typeof wire.r !== "string" ||
    !PATH_PATTERN.test(wire.r) ||
    wire.r.includes("//")
  ) {
    return null;
  }
  if (wire.t !== 0 && wire.t !== 1) return null;
  return {
    peerId: wire.p,
    secret: wire.s,
    server: {
      host: wire.h,
      port: wire.o,
      path: wire.r,
      secure: wire.t === 1,
    },
  };
}

export function encodeBridgePairing(pairing: BridgePairing): string {
  const wire: WirePairing = {
    v: 1,
    p: pairing.peerId,
    s: pairing.secret,
    h: pairing.server.host,
    o: pairing.server.port,
    r: pairing.server.path,
    t: pairing.server.secure ? 1 : 0,
  };
  if (!validatePairing({ ...wire })) {
    throw new Error("بيانات الربط غير صالحة.");
  }
  const encoded = base64UrlEncode(textEncoder.encode(JSON.stringify(wire)));
  const payload = `${BRIDGE_PREFIX}${encoded}`;
  if (payload.length > BRIDGE_MAX_PAYLOAD_CHARS) {
    throw new Error("رمز الربط أطول من المسموح.");
  }
  return payload;
}

/**
 * يقبل النص الخام (QFB1.…) أو رابطاً كاملاً ينتهي بـ `#QFB1.…`.
 * يعيد null لأي إدخال لا يطابق الصيغة بدقة (لا تخمين ولا قبول جزئي).
 */
export function decodeBridgePairing(input: string): BridgePairing | null {
  const trimmed = input.trim();
  const match = PAYLOAD_PATTERN.exec(trimmed);
  if (!match) return null;
  const bytes = base64UrlDecode(match[1]);
  if (!bytes || bytes.length === 0 || bytes.length > 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
  return validatePairing(parsed);
}

/** الرابط الذي يُعرض في QR: أصل الموقع + /pc + الحمولة في الجزء. */
export function bridgeShareUrl(origin: string, payload: string): string {
  return `${origin.replace(/\/+$/, "")}${BRIDGE_PATH}#${payload}`;
}

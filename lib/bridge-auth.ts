/**
 * مصادقة جسر QRFerry (الربط بين الهاتف والكمبيوتر).
 *
 * المبدأ:
 *  - رمز سري عشوائي 128 بت (22 حرفاً base64url) يُعرض في QR فقط — لا يمر أبداً
 *    عبر خادم الإشارة (على عكس الرقم المكوّن من 6 خانات في النقل السريع القديم).
 *  - كل طرف يثبت معرفته بالرمز عبر HMAC-SHA256 على «نص تحقق» (transcript) يشمل:
 *      • بصمتي DTLS للطرفين (من SDP) — فأي وسيط في خادم الإشارة يُغيّر البصمة
 *        فيفشل التحقق تلقائياً (ربط القناة بالتشفير Channel Binding).
 *      • نونسين عشوائيين (واحد من كل طرف) — يمنع إعادة تشغيل البروفات القديمة.
 *  - HMAC يُتحقَّق منه عبر crypto.subtle.verify (مقارنة ثابتة الزمن).
 *
 * هذا الملف لا يعتمد على DOM — يعمل في المتصفح وفي اختبارات Node.
 */

export type BridgeRole = "host" | "joiner";

/** 16 بايت = 128 بت عشوائية. */
export const BRIDGE_SECRET_BYTES = 16;
/** 16 بايت بترميز base64url بدون حشو = 22 حرفاً بالضبط. */
export const BRIDGE_SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const FINGERPRINT_PATTERN =
  /^a=fingerprint:sha-256 ((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\s*$/gim;
const textEncoder = new TextEncoder();

/** تحويل آمن لأنواع TypeScript الحديثة (ArrayBufferLike) إلى BufferSource. */
export function bufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return null;
  const standard = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(standard);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** رمز سري جديد للجلسة (128 بت). */
export function generateBridgeSecret(): string {
  return randomBase64Url(BRIDGE_SECRET_BYTES);
}

/** نونس تحقق جديد (128 بت). */
export function generateBridgeNonce(): string {
  return randomBase64Url(BRIDGE_SECRET_BYTES);
}

/** معرّف رسالة/ملف قصير وعشوائي. */
export function generateBridgeId(): string {
  return randomBase64Url(9);
}

export function isBridgeNonce(value: unknown): value is string {
  return typeof value === "string" && BRIDGE_SECRET_PATTERN.test(value);
}

export async function importBridgeKey(secret: string): Promise<CryptoKey> {
  if (!BRIDGE_SECRET_PATTERN.test(secret)) {
    throw new Error("رمز الربط غير صالح.");
  }
  const raw = base64UrlDecode(secret);
  if (!raw || raw.length !== BRIDGE_SECRET_BYTES) {
    throw new Error("رمز الربط غير صالح.");
  }
  return crypto.subtle.importKey(
    "raw",
    bufferSource(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * يستخرج كل بصمات DTLS من SHA-256 في SDP ويعيدها كقائمة مرتبة ومفصولة بـ `;`.
 * القائمة نفسها عند الطرفين عندما يكون SDP الواحد هو نفسه الذي رآه الآخر.
 * يعيد null إذا لم توجد أي بصمة (ترفض الجلسة في هذه الحالة — fail closed).
 */
export function dtlsFingerprintsFromSdp(
  sdp: string | null | undefined,
): string | null {
  if (!sdp) return null;
  const found = new Set<string>();
  for (const match of sdp.matchAll(FINGERPRINT_PATTERN)) {
    found.add(match[1].toUpperCase());
  }
  if (found.size === 0) return null;
  return [...found].sort().join(";");
}

export type BridgeTranscriptInput = {
  hostFingerprint: string;
  joinerFingerprint: string;
  hostNonce: string;
  joinerNonce: string;
};

/** نص التحقق الذي يُوقَّع — ترتيب الحقول ثابت ومحدد بدقة. */
export function bridgeTranscript(input: BridgeTranscriptInput): Uint8Array {
  return textEncoder.encode(
    `QFB1|host=${input.hostFingerprint}|joiner=${input.joinerFingerprint}|hn=${input.hostNonce}|jn=${input.joinerNonce}`,
  );
}

function proofMessage(role: BridgeRole, transcript: Uint8Array): Uint8Array {
  const label = textEncoder.encode(`${role}|`);
  const message = new Uint8Array(label.length + transcript.length);
  message.set(label, 0);
  message.set(transcript, label.length);
  return message;
}

/** بروفة HMAC لدور معيّن — تُرسَل base64url. */
export async function computeBridgeProof(
  key: CryptoKey,
  role: BridgeRole,
  transcript: Uint8Array,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    bufferSource(proofMessage(role, transcript)),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifyBridgeProof(
  key: CryptoKey,
  role: BridgeRole,
  transcript: Uint8Array,
  proof: unknown,
): Promise<boolean> {
  if (typeof proof !== "string" || proof.length !== 43) return false;
  const signature = base64UrlDecode(proof);
  if (!signature || signature.length !== 32) return false;
  return crypto.subtle.verify(
    "HMAC",
    key,
    bufferSource(signature),
    bufferSource(proofMessage(role, transcript)),
  );
}

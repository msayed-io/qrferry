/**
 * التوقيع الرقمي للملفات (Sender Authenticity) — ECDSA P-256 + SHA-256
 * عبر WebCrypto. يعمل في المتصفح وفي Node 20+ (webcrypto) للاختبارات.
 *
 * الفكرة: المرسل يوقّع هاش (SHA-256) لمحتوى الحزمة؛ المستقبل يتحقق
 * بالتوقيع بمفتاح عام موثوق — فيتأكد أن الملف أتى فعلاً من المرسل.
 */

const textEncoder = new TextEncoder();

/** تحويل نوعي آمن لـ BufferSource (لا ينسخ أي بايت). */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export async function hashSha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    asBufferSource(data),
  );
  return new Uint8Array(digest);
}

export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

export async function exportPublicKeyRaw(publicKey: CryptoKey): Promise<Uint8Array> {
  const raw = await globalThis.crypto.subtle.exportKey("raw", publicKey);
  return new Uint8Array(raw);
}

export async function importPublicKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    asBufferSource(raw),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
}

export async function importPrivateKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "pkcs8",
    asBufferSource(raw),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
}

export async function exportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<Uint8Array> {
  const raw = await globalThis.crypto.subtle.exportKey("pkcs8", privateKey);
  return new Uint8Array(raw);
}

/** يوقّع هاش المحتوى (SHA-256) ويرجع توقيعاً واحداً. */
export async function signHash(
  privateKey: CryptoKey,
  content: Uint8Array,
): Promise<Uint8Array> {
  const digest = await hashSha256(content);
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    asBufferSource(digest),
  );
  return new Uint8Array(signature);
}

/** يتحقق من توقيع على محتوى بمفتاح عام. */
export async function verifySignature(
  publicKey: CryptoKey,
  content: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const digest = await hashSha256(content);
    return globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      asBufferSource(signature),
      asBufferSource(digest),
    );
  } catch {
    return false;
  }
}

/** يعرض مفتاحاً عاماً خاماً كنص قصير قابل للعرض/المشاركة. */
export function formatPublicKeyFingerprint(raw: Uint8Array): string {
  const hex = Array.from(raw.slice(0, 8), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${raw.length * 8}bit:${hex}…`;
}

/** يُولّد معرف هوية نصياً من المفتاح العام (للترابط). */
export function encodePublicKey(raw: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...raw));
  return `QFPUB:${base64}`;
}

export function decodePublicKey(value: string): Uint8Array | null {
  const prefix = "QFPUB:";
  if (!value.startsWith(prefix)) return null;
  try {
    const base64 = value.slice(prefix.length);
    const binary = atob(base64);
    const raw = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      raw[index] = binary.charCodeAt(index);
    }
    if (raw.length !== 65) return null; // P-256 public key uncompressed
    return raw;
  } catch {
    return null;
  }
}

export { textEncoder };

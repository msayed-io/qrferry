/**
 * تشفير اختياري للملف قبل نقله بصرياً.
 *
 * المبدأ: يُشفَّر المحتوى المضغوط بـ AES-256-GCM، ويُشتق المفتاح من كلمة مرور
 * المستخدم عبر PBKDF2-SHA-256. تُنقل الملح (salt) و IV داخل الحمولة نفسها لأنها
 * ليست سرّية — السرّ الوحيد هو كلمة المرور. أي جهة تعترض البثّ ضوئياً دون
 * كلمة المرور لن تستطيع فك الملف.
 *
 * تنسيق الحمولة المشفرة داخل الحاوية البصرية:
 *   [QFCX (4 بايت)] [salt (16)] [iv (12)] [ciphertext + tag (AES-GCM)]
 */

export const CRYPTO_MAGIC = new Uint8Array([0x51, 0x46, 0x43, 0x58]); // "QFCX"
export const CRYPTO_PREFIX_BYTES = CRYPTO_MAGIC.length + 16 + 12; // 4 + 16 + 12 = 32
export const PBKDF2_ITERATIONS = 310_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

const textEncoder = new TextEncoder();

/**
 * تحويل نوعي آمن: أي Uint8Array هو BufferSource صالح في زمن التشغيل،
 * لكن توقيعات TS الجديدة تفرّق بين ArrayBufferLike و ArrayBuffer.
 * لا يُنسخ أي بايت هنا — مجرد توضيح نوع للمترجم.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function isEncryptedPayload(payload: Uint8Array): boolean {
  if (payload.length < CRYPTO_PREFIX_BYTES + 16) return false;
  for (let index = 0; index < CRYPTO_MAGIC.length; index += 1) {
    if (payload[index] !== CRYPTO_MAGIC[index]) return false;
  }
  return true;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const baseKey = await subtle.importKey(
    "raw",
    asBufferSource(textEncoder.encode(password)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

export function extractCryptoHeader(payload: Uint8Array): {
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
} {
  if (!isEncryptedPayload(payload)) {
    throw new Error("الحمولة ليست مشفرة (QFCX).");
  }
  const salt = payload.slice(
    CRYPTO_MAGIC.length,
    CRYPTO_MAGIC.length + SALT_BYTES,
  );
  const iv = payload.slice(
    CRYPTO_MAGIC.length + SALT_BYTES,
    CRYPTO_MAGIC.length + SALT_BYTES + IV_BYTES,
  );
  const ciphertext = payload.slice(CRYPTO_PREFIX_BYTES);
  return { salt, iv, ciphertext };
}

export async function encryptPayload(
  plaintext: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const normalized = normalizePassword(password);
  if (normalized.length < 4) {
    throw new Error("كلمة المرور يجب ألا تقل عن 4 أحرف.");
  }
  const subtle = globalThis.crypto.subtle;
  const salt = new Uint8Array(SALT_BYTES);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);
  const key = await deriveKey(normalized, salt);
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      key,
      asBufferSource(plaintext),
    ),
  );
  return concat([CRYPTO_MAGIC, salt, iv, ciphertext]);
}

/**
 * يفك تشفير حمولة مشفرة. إذا فشل تحقق GCM (كلمة مرور خاطئة أو عبث بالبيانات)
 * يُرمى خطأ يحمل رسالة واضحة، ويُرمى الخطأ الأصلي كخاصية `cause` للتصحيح.
 */
export async function decryptPayload(
  payload: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const { salt, iv, ciphertext } = extractCryptoHeader(payload);
  const normalized = normalizePassword(password);
  const subtle = globalThis.crypto.subtle;
  const key = await deriveKey(normalized, salt);
  try {
    return new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv: asBufferSource(iv) },
        key,
        asBufferSource(ciphertext),
      ),
    );
  } catch (cause) {
    const error = new Error(
      "تعذّر فك التشفير: كلمة المرور غير صحيحة أو البيانات المعدَّلة لا تطابق التوقيع.",
    );
    (error as Error & { cause?: unknown }).cause = cause;
    throw error;
  }
}

export function decodeSaltIvForDisplay(payload: Uint8Array): string {
  try {
    const { salt, iv } = extractCryptoHeader(payload);
    return `${bytesToHex(salt)}/${bytesToHex(iv)}`;
  } catch {
    return "";
  }
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

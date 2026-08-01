/**
 * حزمة النقل (Transfer Package) — تنسيق ثنائي يغلّف محتوى النقل البصري.
 *
 * يسمح بنقل:
 *  - ملف واحد (توافق مع التجربة الحالية)
 *  - عدة ملفات / مجلد (bundle) في بث واحد
 *  - ميزات اختيارية: حذف بعد القراءة (burn), توقيع رقمي (signature)
 *
 * تُبنى الحزمة ثم يُشفَّر المحتوى (اختيارياً) وتُغلَّف داخل الحاوية البصرية
 * (QFC4) كالمعتاد؛ عند الاستقبال يُفحَص الـ magic فتُفك الحزمة.
 *
 * التخطيط الثنائي (Little-Endian):
 *   [0-3]   magic "QFPA"
 *   [4]     version = 1
 *   [5]     flags (bit0 burn | bit1 signed | bit2 multi)
 *   [6]     signerNameLen (u8)
 *   [7-8]   signatureLen (u16)
 *   [9-10]  fileCount (u16)
 *   [11]    signerPublicKeyLen (u8)
 *   [12..]  signerName (bytes)
 *   [..]    signature (bytes)
 *   [..]    signerPublicKey (bytes)
 *   [جدول الملفات] لكل ملف: nameLen u16, mimeLen u16, size u32, crc u32, name, mime
 *   [البيانات] بايتات كل ملف متتالية بنفس ترتيب الجدول
 */

import { crc32 } from "./optical-transfer";

export const PACKAGE_MAGIC = new Uint8Array([0x51, 0x46, 0x50, 0x41]); // "QFPA"
export const PACKAGE_VERSION = 1;

export const FLAG_BURN_AFTER_READING = 1 << 0;
export const FLAG_SIGNED = 1 << 1;
export const FLAG_MULTI = 1 << 2;

export const MAX_PACKAGE_FILES = 256;
export const MAX_NAME_BYTES = 255;
export const MAX_MIME_BYTES = 127;
export const MAX_SIGNER_NAME_BYTES = 255;
export const MAX_SIGNATURE_BYTES = 512;
export const MAX_FILE_BYTES_PACKAGE = 0xffffffff;

export type PackageFile = {
  name: string;
  mime: string;
  bytes: Uint8Array;
};

export type TransferPackage = {
  files: PackageFile[];
  burnAfterReading: boolean;
  signerName: string | null;
  signature: Uint8Array | null;
  signerPublicKey: Uint8Array | null;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function isTransferPackage(bytes: Uint8Array): boolean {
  if (bytes.length < PACKAGE_MAGIC.length + 7) return false;
  for (let index = 0; index < PACKAGE_MAGIC.length; index += 1) {
    if (bytes[index] !== PACKAGE_MAGIC[index]) return false;
  }
  return true;
}

function utf8Bytes(value: string, maxBytes: number): Uint8Array {
  const encoded = textEncoder.encode(value);
  if (encoded.length <= maxBytes) return encoded;
  // اقتطاع آمن عند حدود حروف UTF-8
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return encoded.slice(0, end);
}

export function buildTransferPackage(options: {
  files: PackageFile[];
  burnAfterReading?: boolean;
  signerName?: string;
  signature?: Uint8Array;
  signerPublicKey?: Uint8Array;
}): Uint8Array {
  const files = options.files;
  if (files.length === 0) throw new Error("حزمة النقل يجب أن تحتوي ملفاً واحداً على الأقل.");
  if (files.length > MAX_PACKAGE_FILES) {
    throw new Error(`عدد الملفات في الحزمة يتجاوز الحد (${MAX_PACKAGE_FILES}).`);
  }

  const signerNameBytes = options.signerName
    ? utf8Bytes(options.signerName, MAX_SIGNER_NAME_BYTES)
    : new Uint8Array(0);
  const signature = options.signature ?? new Uint8Array(0);
  if (signature.length > MAX_SIGNATURE_BYTES) {
    throw new Error("حجم التوقيع يتجاوز الحد المسموح.");
  }
  const signerPublicKey = options.signerPublicKey ?? new Uint8Array(0);
  if (signerPublicKey.length > 128) {
    throw new Error("حجم المفتاح العام يتجاوز الحد المسموح.");
  }

  let flags = 0;
  if (options.burnAfterReading) flags |= FLAG_BURN_AFTER_READING;
  if (signature.length > 0) flags |= FLAG_SIGNED;
  if (files.length > 1) flags |= FLAG_MULTI;

  const records: Array<{
    name: Uint8Array;
    mime: Uint8Array;
    size: number;
    crc: number;
  }> = [];
  let tableBytes = 0;
  let dataBytes = 0;
  for (const file of files) {
    if (file.bytes.length > MAX_FILE_BYTES_PACKAGE) {
      throw new Error("حجم ملف داخل الحزمة يتجاوز الحد.");
    }
    const name = utf8Bytes(file.name || "transfer.bin", MAX_NAME_BYTES);
    const mime = utf8Bytes(file.mime || "application/octet-stream", MAX_MIME_BYTES);
    records.push({ name, mime, size: file.bytes.length, crc: crc32(file.bytes) });
    tableBytes += 2 + 2 + 4 + 4 + name.length + mime.length;
    dataBytes += file.bytes.length;
  }

  const headerLen = 4 + 1 + 1 + 1 + 2 + 2 + 1;
  const total = headerLen + signerNameBytes.length + signature.length + signerPublicKey.length + tableBytes + dataBytes;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let offset = 0;

  output.set(PACKAGE_MAGIC, offset);
  offset += 4;
  output[offset] = PACKAGE_VERSION;
  offset += 1;
  output[offset] = flags;
  offset += 1;
  output[offset] = signerNameBytes.length;
  offset += 1;
  view.setUint16(offset, signature.length, true);
  offset += 2;
  view.setUint16(offset, records.length, true);
  offset += 2;
  output[offset] = signerPublicKey.length;
  offset += 1;

  output.set(signerNameBytes, offset);
  offset += signerNameBytes.length;
  output.set(signature, offset);
  offset += signature.length;
  output.set(signerPublicKey, offset);
  offset += signerPublicKey.length;

  for (const record of records) {
    view.setUint16(offset, record.name.length, true);
    offset += 2;
    view.setUint16(offset, record.mime.length, true);
    offset += 2;
    view.setUint32(offset, record.size, true);
    offset += 4;
    view.setUint32(offset, record.crc, true);
    offset += 4;
    output.set(record.name, offset);
    offset += record.name.length;
    output.set(record.mime, offset);
    offset += record.mime.length;
  }

  for (const file of files) {
    output.set(file.bytes, offset);
    offset += file.bytes.length;
  }

  if (offset !== total) {
    throw new Error("خطأ داخلي في بناء حزمة النقل (عدم تطابق الأطوال).");
  }
  return output;
}

export function parseTransferPackage(bytes: Uint8Array): TransferPackage {
  if (!isTransferPackage(bytes)) {
    throw new Error("هذه ليست حزمة نقل QFPA.");
  }
  if (bytes.length < 4 + 1 + 1 + 1 + 2 + 2) {
    throw new Error("حزمة النقل قصيرة جداً.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PACKAGE_MAGIC.length;

  const version = bytes[offset];
  offset += 1;
  if (version !== PACKAGE_VERSION) {
    throw new Error(`إصدار حزمة النقل غير مدعوم (${version}).`);
  }
  const flags = bytes[offset];
  offset += 1;
  const signerNameLen = bytes[offset];
  offset += 1;
  const signatureLen = view.getUint16(offset, true);
  offset += 2;
  const fileCount = view.getUint16(offset, true);
  offset += 2;
  const signerPublicKeyLen = bytes[offset];
  offset += 1;

  if (fileCount < 1 || fileCount > MAX_PACKAGE_FILES) {
    throw new Error("عدد الملفات في حزمة النقل غير صالح.");
  }
  if (signatureLen > MAX_SIGNATURE_BYTES || signerNameLen > MAX_SIGNER_NAME_BYTES) {
    throw new Error("ترويسة حزمة النقل غير صالحة.");
  }
  if (signerPublicKeyLen > 128) {
    throw new Error("ترويسة حزمة النقل غير صالحة (مفتاح عام).");
  }

  const signerName = signerNameLen > 0
    ? textDecoder.decode(bytes.subarray(offset, offset + signerNameLen))
    : null;
  offset += signerNameLen;
  const signature = signatureLen > 0
    ? bytes.slice(offset, offset + signatureLen)
    : null;
  offset += signatureLen;
  const signerPublicKey = signerPublicKeyLen > 0
    ? bytes.slice(offset, offset + signerPublicKeyLen)
    : null;
  offset += signerPublicKeyLen;

  const records: Array<{ nameLen: number; mimeLen: number; size: number; crc: number }> = [];
  for (let index = 0; index < fileCount; index += 1) {
    if (offset + 12 > bytes.length) throw new Error("جدول ملفات الحزمة ناقص.");
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const mimeLen = view.getUint16(offset, true);
    offset += 2;
    const size = view.getUint32(offset, true);
    offset += 4;
    const crc = view.getUint32(offset, true);
    offset += 4;
    if (nameLen > MAX_NAME_BYTES || mimeLen > MAX_MIME_BYTES || offset + nameLen + mimeLen > bytes.length) {
      throw new Error("سجل ملف في الحزمة غير صالح.");
    }
    records.push({ nameLen, mimeLen, size, crc });
    offset += nameLen + mimeLen;
  }

  const files: PackageFile[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const record = records[index];
    if (offset + record.size > bytes.length) {
      throw new Error("بيانات ملف في الحزمة ناقصة.");
    }
    // نقرأ الاسم و MIME من الجدول مرة أخرى؟ لا — نحفظهما أثناء اجتياز الجدول.
    files.push({ name: "", mime: "", bytes: bytes.slice(offset, offset + record.size) });
    offset += record.size;
  }

  // اجتياز ثانٍ لقراءة الأسماء و MIME من الجدول (الجدول قبل البيانات)
  // وللتحقق من CRC لكل ملف.
  let tableOffset = 4 + 1 + 1 + 1 + 2 + 2 + 1 + signerNameLen + signatureLen + signerPublicKeyLen;
  for (let index = 0; index < fileCount; index += 1) {
    const record = records[index];
    const name = textDecoder.decode(bytes.subarray(tableOffset + 12, tableOffset + 12 + record.nameLen));
    const mimeStart = tableOffset + 12 + record.nameLen;
    const mime = textDecoder.decode(bytes.subarray(mimeStart, mimeStart + record.mimeLen));
    files[index] = { name: name || "transfer.bin", mime: mime || "application/octet-stream", bytes: files[index].bytes };
    if (crc32(files[index].bytes) !== record.crc) {
      throw new Error(`الملف «${name}» فشل في فحص المجموع داخل الحزمة.`);
    }
    tableOffset += 12 + record.nameLen + record.mimeLen;
  }

  return {
    files,
    burnAfterReading: (flags & FLAG_BURN_AFTER_READING) !== 0,
    signerName,
    signature,
    signerPublicKey,
  };
}

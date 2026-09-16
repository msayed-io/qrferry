import { crc32, MAX_FILE_BYTES } from "./optical-transfer";

// Allow the bounded QFPA table/signature overhead for a maximum-size selection.
export const MAX_FAST_TRANSFER_BYTES = MAX_FILE_BYTES + 1024 * 1024;
export type FastFileHeader = {
  passcode: string;
  name: string;
  mime: string;
  size: number;
};

export function parseFastHeader(
  raw: string,
  expectedPasscode: string,
  metadataPasscode?: string,
): FastFileHeader {
  if (raw.length > 8192) throw new Error("ترويسة الملف أكبر من المسموح.");
  const h = JSON.parse(raw) as Partial<FastFileHeader> | null;
  if (
    !h ||
    typeof h !== "object" ||
    h.passcode !== expectedPasscode ||
    metadataPasscode !== expectedPasscode
  )
    throw new Error("رمز الاقتران غير صالح.");
  if (
    !Number.isSafeInteger(h.size) ||
    (h.size as number) < 0 ||
    (h.size as number) > MAX_FAST_TRANSFER_BYTES
  )
    throw new Error("حجم الملف غير صالح أو يتجاوز الحد.");
  if (
    typeof h.name !== "string" ||
    !h.name ||
    h.name.length > 1024 ||
    typeof h.mime !== "string" ||
    h.mime.length > 255
  )
    throw new Error("بيانات تعريف الملف غير صالحة.");
  return h as FastFileHeader;
}

/** Strict, one-file receive state: no silent zero padding, truncation or early completion. */
export class FastReceiveBuffer {
  private buffer: Uint8Array | null;
  received = 0;
  constructor(readonly header: FastFileHeader) {
    this.buffer = new Uint8Array(header.size);
  }
  push(chunk: Uint8Array): void {
    if (!this.buffer) throw new Error("انتهت جلسة الاستقبال.");
    if (this.received + chunk.byteLength > this.header.size)
      throw new Error("وصلت بيانات تتجاوز الحجم المعلن.");
    this.buffer.set(chunk, this.received);
    this.received += chunk.byteLength;
  }
  finish(expectedCrc: number): Uint8Array {
    if (!this.buffer || this.received !== this.header.size)
      throw new Error("الملف ناقص: لم تصل كل البايتات.");
    if (
      !Number.isInteger(expectedCrc) ||
      expectedCrc < 0 ||
      expectedCrc > 0xffffffff ||
      crc32(this.buffer) !== expectedCrc
    )
      throw new Error("فشل المجموع الاختباري للملف.");
    const bytes = this.buffer;
    this.buffer = null;
    return bytes;
  }
  clear(): void {
    this.buffer = null;
  }
}

import {
  buildTransferPackage,
  isTransferPackage,
  parseTransferPackage,
  FLAG_SIGNED,
} from "./transfer-package";
import { importPublicKeyRaw, verifySignature } from "./signing";
import type { IncomingTransferFile } from "./fast-transfer";

const extensions: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wave: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};
const aliases: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-flac": "audio/flac",
};

/** Correct metadata only; never pretend that changing MIME transcodes a codec. */
export function resolveMediaMime(
  name: string,
  declared: string,
  bytes: Uint8Array,
): string {
  const mime = declared.trim().toLowerCase();
  const base = mime.split(";")[0].trim();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (ascii(0, 4) === "OggS")
    return base.startsWith("video/") || ext === "ogv"
      ? "video/ogg"
      : "audio/ogg";
  if (ascii(4, 4) === "ftyp")
    return ext === "m4a" || base.startsWith("audio/")
      ? "audio/mp4"
      : "video/mp4";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    if ((bytes[1] & 0xf6) === 0xf0) return "audio/aac"; // ADTS
    if ((bytes[1] & 0x06) !== 0) return "audio/mpeg"; // MPEG audio frame sync
  }
  if (aliases[base]) return aliases[base];
  if (
    !base ||
    [
      "application/octet-stream",
      "binary/octet-stream",
      "application/binary",
    ].includes(base)
  ) {
    return extensions[ext] ?? "application/octet-stream";
  }
  return mime;
}

export type ReceivedMediaFile = {
  name: string;
  mime: string;
  bytes: Uint8Array;
};
export type ReceivedDelivery = {
  files: ReceivedMediaFile[];
  signature: "unsigned" | "valid-untrusted" | "valid-trusted";
};

/** Shared by live TV delivery and reopening legacy QFPA entries from its library. */
export async function unpackReceivedDelivery(
  file: IncomingTransferFile,
  trustedKeys: Uint8Array[] = [],
): Promise<ReceivedDelivery> {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.bytes.byteLength !== file.size
  ) {
    throw new Error("البيانات المستلمة لا تطابق حجم الملف. أعد الإرسال.");
  }
  let files: ReceivedMediaFile[] = [
    { name: file.name, mime: file.mime, bytes: file.bytes },
  ];
  let signature: ReceivedDelivery["signature"] = "unsigned";
  if (
    file.mime.split(";")[0] === "application/x-qrferry-package" ||
    isTransferPackage(file.bytes)
  ) {
    const parsed = parseTransferPackage(file.bytes);
    // Do not silently persist content whose sender requested a deletion policy this player cannot guarantee.
    if (parsed.burnAfterReading)
      throw new Error(
        "الحذف بعد القراءة غير مدعوم على الشاشة. أعد الإرسال دون هذا الخيار، أو استخدم صفحة المسح /scan. لم تُحفظ هذه الحزمة في المكتبة.",
      );
    if (
      parsed.signature ||
      parsed.signerPublicKey ||
      file.bytes[5] & FLAG_SIGNED
    ) {
      if (!parsed.signature || !parsed.signerPublicKey)
        throw new Error("توقيع الحزمة ناقص. لم يُقبل الملف.");
      const canonical = buildTransferPackage({
        files: parsed.files,
        burnAfterReading: false,
      });
      const key = await importPublicKeyRaw(parsed.signerPublicKey);
      if (!(await verifySignature(key, canonical, parsed.signature)))
        throw new Error("فشل التحقق من توقيع الحزمة. لم يُقبل الملف.");
      const raw = parsed.signerPublicKey;
      signature = trustedKeys.some(
        (k) => k.length === raw.length && k.every((b, i) => b === raw[i]),
      )
        ? "valid-trusted"
        : "valid-untrusted";
    }
    files = parsed.files;
  }
  return {
    files: files.map((f) => ({
      ...f,
      mime: resolveMediaMime(f.name, f.mime, f.bytes),
    })),
    signature,
  };
}

/** Blob must contain the view, not unrelated bytes from its backing ArrayBuffer. */
export function receivedBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: mime });
}

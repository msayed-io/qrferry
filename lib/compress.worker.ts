/**
 * عامل الضغط: ينفّذ الضغط (Brotli-11 ضد gzip-9) خارج الخيط الرئيسي
 * حتى لا تتجمد الواجهة عند الملفات الكبيرة. يرسل ArrayBuffer عبر
 * نقل (transferable) لتقليل النسخ.
 */
import { gzip } from "fflate";

type CompressWorkerRequest = {
  id: number;
  bytes: ArrayBuffer;
};

type CompressWorkerResponse =
  | {
      id: number;
      ok: true;
      compressed: ArrayBuffer;
      mode: "gzip" | "brotli" | "none";
      savedBytes: number;
    }
  | { id: number; ok: false; error: string };

const textEncoder = new TextEncoder();

async function brotliCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const brotliPackage = await import("brotli-wasm");
  const brotli = await brotliPackage.default;
  return new Uint8Array(brotli.compress(bytes, { quality: 11 }));
}

function gzipAsync(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    gzip(bytes, { level: 9, mem: 12, mtime: 0 }, (error, compressed) => {
      if (error) reject(error);
      else resolve(compressed);
    });
  });
}

function post(response: CompressWorkerResponse, transfer?: Transferable[]) {
  (self as unknown as {
    postMessage(message: unknown, transfer?: Transferable[]): void;
  }).postMessage(response, transfer);
}

self.onmessage = async (event: MessageEvent<CompressWorkerRequest>) => {
  const { id, bytes } = event.data;
  try {
    const input = new Uint8Array(bytes);
    let compressed: Uint8Array;
    let mode: "gzip" | "brotli" | "none";

    if (input.length < 768) {
      post({ id, ok: true, compressed: input.slice().buffer, mode: "none", savedBytes: 0 });
      return;
    }

    const gzipPromise = gzipAsync(input);
    const brotliPromise = brotliCompress(input).catch(() => undefined);
    const [gzipBytes, brotliBytes] = await Promise.all([gzipPromise, brotliPromise]);
    if (brotliBytes && brotliBytes.length < gzipBytes.length) {
      compressed = brotliBytes;
      mode = "brotli";
    } else {
      compressed = gzipBytes;
      mode = "gzip";
    }

    if (compressed.length + 64 >= input.length) {
      post({ id, ok: true, compressed: input.slice().buffer, mode: "none", savedBytes: 0 });
      return;
    }
    post({
      id,
      ok: true,
      compressed: compressed.slice().buffer,
      mode,
      savedBytes: input.length - compressed.length,
    });
  } catch (cause) {
    post({
      id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

export { textEncoder };

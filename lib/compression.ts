import { gzip, gunzip } from "fflate";

export type CompressionMode = "none" | "gzip" | "brotli";

function gzipAsync(bytes: Uint8Array) {
  return new Promise<Uint8Array>((resolve, reject) => {
    gzip(bytes, { level: 9, mem: 12, mtime: 0 }, (error, compressed) => {
      if (error) reject(error);
      else resolve(compressed);
    });
  });
}

function gunzipAsync(bytes: Uint8Array) {
  return new Promise<Uint8Array>((resolve, reject) => {
    gunzip(bytes, (error, decompressed) => {
      if (error) reject(error);
      else resolve(decompressed);
    });
  });
}

async function brotliCompress(bytes: Uint8Array) {
  const brotliPackage = await import("brotli-wasm");
  const brotli = await brotliPackage.default;
  return new Uint8Array(brotli.compress(bytes, { quality: 11 }));
}

async function brotliDecompress(bytes: Uint8Array) {
  const brotliPackage = await import("brotli-wasm");
  const brotli = await brotliPackage.default;
  return new Uint8Array(brotli.decompress(bytes));
}

export async function compressForTransfer(bytes: Uint8Array): Promise<{
  bytes: Uint8Array;
  mode: CompressionMode;
  savedBytes: number;
}> {
  if (bytes.length < 768) {
    return { bytes, mode: "none", savedBytes: 0 };
  }

  const gzipPromise = gzipAsync(bytes);
  const brotliPromise = brotliCompress(bytes).catch(() => undefined);
  const [gzipBytes, brotliBytes] = await Promise.all([
    gzipPromise,
    brotliPromise,
  ]);
  const best =
    brotliBytes && brotliBytes.length < gzipBytes.length
      ? { bytes: brotliBytes, mode: "brotli" as const }
      : { bytes: gzipBytes, mode: "gzip" as const };
  // Keep a small safety margin: a token saving is not worth decompression work.
  if (best.bytes.length + 64 >= bytes.length) {
    return { bytes, mode: "none", savedBytes: 0 };
  }
  return {
    ...best,
    savedBytes: bytes.length - best.bytes.length,
  };
}

export async function decompressTransfer(
  bytes: Uint8Array,
  mode: CompressionMode,
) {
  if (mode === "gzip") return gunzipAsync(bytes);
  if (mode === "brotli") return brotliDecompress(bytes);
  return bytes;
}

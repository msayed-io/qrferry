/// <reference lib="webworker" />
/** The decoder and resume store live exclusively here. Camera pixels and recovered
 * file buffers cross the worker boundary by ownership transfer, never JSON/base64. */
import { prepareQrScanner, scanRawQrs } from "./qr-scanner";
import { RaptorQWasmDecoder } from "@raptorqr/core/fec/raptorq_wasm";
import {
  crc32,
  parseOpticalFrame,
  parseOpticalContainer,
  raptorPacketKey,
} from "./optical-transfer";
import {
  loadSession,
  saveSession,
  deleteSession,
  evictOldSessions,
  sessionKey,
  payloadSymbolKey,
  MAX_SYMBOLS_STORED,
} from "./resume-store";
import { decryptPayload } from "./encryption";
import { decompressTransfer } from "./compression";
import {
  isTransferPackage,
  parseTransferPackage,
  buildTransferPackage,
} from "./transfer-package";
import { importPublicKeyRaw, verifySignature } from "./signing";
import type {
  ScanRequest,
  ScanSnapshot,
  ReceiverMeta,
  RecoveryResult,
  ScanResult,
} from "./scan-worker-types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let decoder: RaptorQWasmDecoder | undefined;
let incoming: ReceiverMeta | undefined;
const seen = new Set<string>();
let payloads: Uint8Array[] = [];
let container: Uint8Array | null = null;
let dirty = false;
let lastSave = 0;
let reads = 0,
  bad = 0,
  resumed = 0;
let guidance: ScanSnapshot["guidance"] = "locked";
const snapshot = (): ScanSnapshot => ({
  reads,
  bad,
  accepted: seen.size,
  resumed,
  incoming,
  complete: !!container,
  guidance,
});
async function flush() {
  if (!dirty || !incoming || container) return;
  const key = sessionKey(
    incoming.session,
    incoming.containerLength,
    incoming.symbolSize,
  );
  try {
    await saveSession({ ...incoming, key, payloads, updatedAt: Date.now() });
    await evictOldSessions(2);
    dirty = false;
    lastSave = performance.now();
  } catch {
    /* Optional persistence never falsifies receipt. */
  }
}
async function accept(bytes: Uint8Array) {
  reads++;
  let frame;
  try {
    frame = parseOpticalFrame(bytes);
  } catch {
    const prefix = new TextDecoder().decode(bytes.subarray(0, 3));
    guidance = prefix === "QF2" || prefix === "QF3" ? "oldSender" : "badFrame";
    bad++;
    return;
  }
  if (!incoming) {
    incoming = {
      session: frame.session,
      containerLength: frame.containerLength,
      originalSize: frame.originalSize,
      compressed: frame.compressed,
      symbolSize: frame.symbolSize,
      sourcePacketCount: Math.max(
        1,
        Math.ceil(frame.containerLength / (frame.symbolSize - 4)),
      ),
    };
    decoder = await RaptorQWasmDecoder.create(
      frame.containerLength,
      frame.symbolSize,
    );
    const stored = await loadSession(
      sessionKey(frame.session, frame.containerLength, frame.symbolSize),
    );
    if (stored)
      for (const payload of stored.payloads) {
        if (payload.length < 4) continue;
        const key = payloadSymbolKey(frame.session, payload);
        if (seen.has(key)) continue;
        seen.add(key);
        payloads.push(payload);
        container = decoder.push(payload);
        if (container) break;
      }
    resumed = seen.size;
  }
  if (
    frame.session !== incoming.session ||
    frame.containerLength !== incoming.containerLength ||
    frame.symbolSize !== incoming.symbolSize
  ) {
    guidance = "different";
    return;
  }
  if (container) return;
  const key = raptorPacketKey(frame);
  if (seen.has(key)) {
    guidance = "duplicate";
    return;
  }
  seen.add(key);
  if (payloads.length < MAX_SYMBOLS_STORED) payloads.push(frame.payload);
  dirty = true;
  container = decoder!.push(frame.payload);
  guidance = frame.symbolSize > 2200 ? "highDensity" : "lockedSymbol";
  if (performance.now() - lastSave >= 2000) await flush();
}
async function recover(password?: string): Promise<RecoveryResult> {
  if (!container || !incoming)
    throw new Error("No complete transfer is available.");
  if (
    container.length !== incoming.containerLength ||
    crc32(container) !== incoming.session
  )
    throw new Error("Transfer checksum mismatch.");
  const recovered = parseOpticalContainer(container);
  if (recovered.meta.encrypted && !password) return { passwordRequired: true };
  const transmitted = recovered.meta.encrypted
    ? await decryptPayload(recovered.transmitted, password!)
    : recovered.transmitted;
  const bytes = await decompressTransfer(
    transmitted,
    recovered.meta.compression,
  );
  if (isTransferPackage(bytes)) {
    const parsed = parseTransferPackage(bytes);
    const signatureValid =
      !!(parsed.signature && parsed.signerPublicKey) &&
      (await verifySignature(
        await importPublicKeyRaw(parsed.signerPublicKey!),
        buildTransferPackage({
          files: parsed.files,
          burnAfterReading: parsed.burnAfterReading,
        }),
        parsed.signature!,
      ));
    return {
      passwordRequired: false,
      files: parsed.files,
      burnAfterReading: parsed.burnAfterReading,
      signed: parsed.signature !== null,
      signerName: parsed.signerName,
      publicKey: parsed.signerPublicKey,
      signatureValid,
      encrypted: recovered.meta.encrypted,
      originalSize: recovered.meta.fileSize,
    };
  }
  if (
    bytes.length !== recovered.meta.fileSize ||
    crc32(bytes) !== recovered.meta.fileCrc
  )
    throw new Error("File checksum mismatch.");
  return {
    passwordRequired: false,
    files: [
      { name: recovered.meta.filename, mime: recovered.meta.mime, bytes },
    ],
    burnAfterReading: false,
    signed: false,
    signerName: null,
    publicKey: null,
    signatureValid: true,
    encrypted: recovered.meta.encrypted,
    originalSize: recovered.meta.fileSize,
  };
}
async function handle(request: ScanRequest): Promise<unknown> {
  if (request.type === "prepare") {
    await prepareQrScanner();
    return null;
  }
  if (request.type === "flush") {
    await flush();
    return null;
  }
  if (request.type === "discard") {
    if (incoming)
      await deleteSession(
        sessionKey(
          incoming.session,
          incoming.containerLength,
          incoming.symbolSize,
        ),
      );
    container = null;
    decoder = undefined;
    payloads = [];
    dirty = false;
    return null;
  }
  if (request.type === "recover") return recover(request.password);
  if (request.type === "frame") {
    await accept(new Uint8Array(request.bytes));
    return snapshot();
  }
  if (request.type !== "scan") throw new Error("Unknown decoder request.");
  const start = performance.now();
  const image = new ImageData(
    new Uint8ClampedArray(request.pixels),
    request.width,
    request.height,
  );
  const raw = await scanRawQrs(image, request.robust, request.count);
  if (request.rawOnly)
    return {
      snapshot: snapshot(),
      texts: [],
      decoded: raw.length,
      decodeMs: performance.now() - start,
      raw,
    } satisfies ScanResult;
  const texts: string[] = [];
  for (const bytes of raw) {
    const prefix = new TextDecoder().decode(bytes.subarray(0, 6));
    if (prefix.startsWith("QFPW:") || prefix.startsWith("QFPUB:")) {
      reads++;
      texts.push(new TextDecoder().decode(bytes));
    } else if (request.purpose === "qr") await accept(bytes);
  }
  return {
    snapshot: snapshot(),
    texts,
    decoded: raw.length,
    decodeMs: performance.now() - start,
  } satisfies ScanResult;
}
// Serial mailbox: no concurrent WASM push/replay/recovery or persistence races.
let queue = Promise.resolve();
// Persist even when the sender is paused or only duplicate symbols arrive.
// Enqueue on the same mailbox so snapshots never race an in-flight push/replay.
setInterval(() => {
  queue = queue.then(flush);
}, 2000);
scope.onmessage = ({ data }: MessageEvent<ScanRequest & { id: number }>) => {
  queue = queue.then(async () => {
    try {
      const result = await handle(data);
      const transfer: ArrayBuffer[] = [];
      const add = (bytes?: Uint8Array | null) => {
        if (
          bytes?.buffer instanceof ArrayBuffer &&
          !transfer.includes(bytes.buffer)
        )
          transfer.push(bytes.buffer);
      };
      if (
        data.type === "recover" &&
        result &&
        !(result as RecoveryResult).passwordRequired
      ) {
        const recovered = result as Exclude<
          RecoveryResult,
          { passwordRequired: true }
        >;
        // detach independent results, not a retained plaintext container needed for password retries.
        recovered.files = recovered.files.map((file) => ({
          ...file,
          bytes: file.bytes.slice(),
        }));
        recovered.files.forEach((file) => add(file.bytes));
        if (recovered.publicKey) {
          recovered.publicKey = recovered.publicKey.slice();
          add(recovered.publicKey);
        }
      }
      if (data.type === "scan") (result as ScanResult).raw?.forEach(add);
      scope.postMessage({ id: data.id, ok: true, result }, transfer);
    } catch (error) {
      scope.postMessage({
        id: data.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

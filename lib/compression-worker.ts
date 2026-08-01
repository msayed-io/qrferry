/**
 * غلاف لاستدعاء عامل الضغط من الخيط الرئيسي.
 * - يعيد استخدام عامل واحد (يُهيَّأ كسولاً).
 * - عند تعطل العامل أو عدم توفره يتراجع تلقائياً إلى الضغط المباشر.
 */

import type { CompressionMode } from "./compression";

type CompressResult = {
  bytes: Uint8Array;
  mode: CompressionMode;
  savedBytes: number;
};

let worker: Worker | undefined;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (result: CompressResult) => void; reject: (error: Error) => void }
>();

function rejectAll(error: Error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function getWorker(): Worker | undefined {
  if (workerFailed) return undefined;
  if (!worker && typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./compress.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent) => {
        const { id, ok, compressed, mode, savedBytes, error } = event.data ?? {};
        const entry = pending.get(id as number);
        if (!entry) return;
        pending.delete(id as number);
        if (ok) {
          entry.resolve({
            bytes: new Uint8Array(compressed as ArrayBuffer),
            mode: mode as CompressionMode,
            savedBytes: savedBytes as number,
          });
        } else {
          entry.reject(new Error(error as string));
        }
      };
      worker.onerror = (event) => {
        workerFailed = true;
        rejectAll(new Error(event.message || "تعطّل عامل الضغط."));
        worker?.terminate();
        worker = undefined;
      };
    } catch {
      workerFailed = true;
      worker = undefined;
    }
  }
  return worker;
}

export async function compressForTransferViaWorker(
  bytes: Uint8Array,
): Promise<CompressResult> {
  const target = getWorker();
  if (!target) {
    const { compressForTransfer } = await import("./compression");
    return compressForTransfer(bytes);
  }

  const id = nextRequestId;
  nextRequestId += 1;
  // ننقل نسخة (لا ننزع ملكية المخزن الأصلي لأنه قد يُعاد استخدامه).
  const copy = bytes.slice();
  return new Promise<CompressResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      target.postMessage({ id, bytes: copy.buffer }, [copy.buffer]);
    } catch {
      pending.delete(id);
      workerFailed = true;
      worker?.terminate();
      worker = undefined;
      void import("./compression").then(({ compressForTransfer }) =>
        compressForTransfer(bytes).then(resolve, reject),
      );
    }
  });
}

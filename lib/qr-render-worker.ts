/**
 * غلاف لاستدعاء عامل رسم QR من الخيط الرئيسي.
 * - ينشئ العامل كسولاً (عند أول استخدام) ويعيد استخدامه.
 * - في حال تعطّل العامل أو عدم توفره، يتراجع تلقائياً إلى الرسم داخل
 *   الخيط الرئيسي — فلا يتوقف البث أبداً.
 */

type RenderOptions = {
  packet: Uint8Array;
  version: number;
  ecc: "L" | "M" | "Q" | "H";
  scale: number;
};

type PendingEntry = {
  resolve: (image: ImageData) => void;
  reject: (error: Error) => void;
};

let worker: Worker | undefined;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<number, PendingEntry>();

function rejectAll(error: Error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function getWorker(): Worker | undefined {
  if (workerFailed) return undefined;
  if (!worker && typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent) => {
        const { id, ok, image, error } = event.data ?? {};
        const entry = pending.get(id as number);
        if (!entry) return;
        pending.delete(id as number);
        if (ok) entry.resolve(image as ImageData);
        else entry.reject(new Error(error as string));
      };
      worker.onerror = (event) => {
        workerFailed = true;
        rejectAll(new Error(event.message || "تعطّل عامل الرسم."));
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

async function fallbackRender(options: RenderOptions): Promise<ImageData> {
  const { renderRawQr } = await import("@/lib/qr-renderer");
  return renderRawQr(
    options.packet,
    options.version,
    options.ecc,
    options.scale,
  );
}

export async function renderRawQrViaWorker(
  options: RenderOptions,
): Promise<ImageData> {
  const target = getWorker();
  if (!target) return fallbackRender(options);

  const id = nextRequestId;
  nextRequestId += 1;
  return new Promise<ImageData>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      // نرسل نسخة من الحزمة (structured clone) حتى لا ننزع ملكية المخزن
      // المؤقت الأصلي في الخيط الرئيسي — الحزم تُعاد استخدامها.
      target.postMessage({ ...options, id });
    } catch {
      pending.delete(id);
      workerFailed = true;
      worker?.terminate();
      worker = undefined;
      void fallbackRender(options).then(resolve, reject);
    }
  });
}

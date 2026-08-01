/**
 * عامل رسم QR: ينقل رسم كل إطار QR (عبر fast_qr WASM) خارج الخيط الرئيسي
 * حتى يبقى بثّ الإطارات سلساً والواجهة متجاوبة.
 */
import init, { QrRenderer, type InitOutput } from "@raptorqr/fast-qr-wasm";

const ECC_NUMBER = { L: 0, M: 1, Q: 2, H: 3 } as const;

export type RenderWorkerRequest = {
  id: number;
  packet: Uint8Array;
  version: number;
  ecc: keyof typeof ECC_NUMBER;
  scale: number;
};

type RenderWorkerResponse =
  | { id: number; ok: true; image: ImageData }
  | { id: number; ok: false; error: string };

let initPromise: Promise<InitOutput> | undefined;
let renderer: QrRenderer | undefined;

/** توقيع postMessage الخاص بالعامل (DOM lib يصنّف self كنافذة). */
type WorkerScope = {
  postMessage(message: unknown, transfer: Transferable[]): void;
};
const workerScope = self as unknown as WorkerScope;

self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  const { id, packet, version, ecc, scale } = event.data;
  try {
    if (!initPromise) initPromise = init();
    const wasm = await initPromise;
    if (!renderer) renderer = new QrRenderer();
    const side = renderer.render_rgba(packet, version, ECC_NUMBER[ecc], scale);
    const length = side * side * 4;
    const view = new Uint8ClampedArray(
      wasm.memory.buffer,
      renderer.rgba_ptr(),
      length,
    );
    const copy = new Uint8ClampedArray(length);
    copy.set(view);
    const image = new ImageData(copy, side, side);
    const response: RenderWorkerResponse = { id, ok: true, image };
    // ننقل بيانات الصورة دون نسخ (transferable) لتقليل الحمل.
    workerScope.postMessage(response, [image.data.buffer]);
  } catch (cause) {
    const response: RenderWorkerResponse = {
      id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
    workerScope.postMessage(response, []);
  }
};

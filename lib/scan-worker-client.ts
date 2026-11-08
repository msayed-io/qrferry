import type {
  RecoveryResult,
  ScanRequest,
  ScanResult,
  ScanSnapshot,
} from "./scan-worker-types";

/** One worker and at most one camera scan in flight per owner. No main-thread
 * decoding fallback: a failed worker produces an explicit retryable error. */
export class ScanWorkerClient {
  private worker: Worker;
  private sequence = 0;
  private closed = false;
  private busy = false;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker = new Worker(new URL("./scan.worker.ts", import.meta.url), {
      type: "module",
      name: "QRFerry QR + RaptorQ",
    });
    this.worker.onmessage = ({ data }) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(data.id);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(data.error));
    };
    this.worker.onerror = (event) =>
      this.fail(
        new Error(event.message || "The decoder worker failed. Please retry."),
      );
    this.worker.onmessageerror = () =>
      this.fail(new Error("The decoder returned an unreadable message."));
  }
  private fail(error: Error) {
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  private request<T>(
    request: ScanRequest,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(new DOMException("Decoder closed", "AbortError"));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(new Error("The decoder did not respond. Please retry.")),
        60000,
      );
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.worker.postMessage({ ...request, id }, transfer);
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  prepare() {
    return this.request<void>({ type: "prepare" });
  }
  async scan(
    image: ImageData,
    robust: boolean,
    count = 1,
    rawOnly = false,
    purpose: "qr" | "password" | "pubkey" = "qr",
  ): Promise<ScanResult> {
    if (this.busy) throw new Error("A camera frame is already in flight.");
    this.busy = true;
    try {
      const pixels = image.data.buffer as ArrayBuffer;
      return await this.request<ScanResult>(
        {
          type: "scan",
          pixels,
          width: image.width,
          height: image.height,
          robust,
          count,
          rawOnly,
          purpose,
        },
        [pixels],
      );
    } finally {
      this.busy = false;
    }
  }
  /** Also used by fixture-based tests; ownership is deliberately transferred. */
  accept(bytes: Uint8Array) {
    const buffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : bytes.slice().buffer;
    return this.request<ScanSnapshot>({ type: "frame", bytes: buffer }, [
      buffer,
    ]);
  }
  recover(password?: string) {
    return this.request<RecoveryResult>({ type: "recover", password });
  }
  discard() {
    return this.request<void>({ type: "discard" });
  }
  flush() {
    return this.request<void>({ type: "flush" });
  }
  async dispose() {
    if (this.closed) return;
    // Flush the final partial session before terminating, with bounded cleanup.
    const timeout = setTimeout(
      () => this.fail(new DOMException("Decoder closed", "AbortError")),
      2500,
    );
    try {
      await this.flush();
    } catch {
      /* The owner is leaving; no UI updates. */
    } finally {
      clearTimeout(timeout);
      this.fail(new DOMException("Decoder closed", "AbortError"));
    }
  }
}

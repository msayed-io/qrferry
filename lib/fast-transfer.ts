/**
 * النقل المحلي السريع (WebRTC عبر PeerJS):
 *  - QR اقتران (QFTV:peerId:passcode) يربط المرسل بالمستقبِل.
 *  - قناة بيانات مشفرة DTLS تلقائياً، بنقل ثنائي فعّال (serialization binary)
 *    وبتحكم ضغط خلفي داخلي من PeerJS — سرعات عشرات الميغابايت/ثانية على LAN.
 *  - لا يمر أي بايت من الملف عبر خادم التسيير (يرسل رسائل الإشارة فقط).
 *
 * خادم التسيير: افتراضياً السحابة العامة (0.peerjs.com)، ويمكن ضبطه عبر
 * localStorage (qrferry-peer-host) لشبكة معزولة بخادم مدمج (حزمة الأوفلاين).
 */

import { crc32 } from "./optical-transfer";

export type PeerServerConfig = {
  host: string;
  port: number;
  path: string;
  secure: boolean;
};

export const DEFAULT_PEER_SERVER: PeerServerConfig = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  secure: true,
};

const PEER_HOST_KEY = "qrferry-peer-host";

export function getPeerServerConfig(): PeerServerConfig {
  try {
    const raw = localStorage.getItem(PEER_HOST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PeerServerConfig>;
      if (parsed && typeof parsed.host === "string") {
        return { ...DEFAULT_PEER_SERVER, ...parsed };
      }
    }
  } catch {
    // تجاهل
  }
  return DEFAULT_PEER_SERVER;
}

export function setPeerServerConfig(config: PeerServerConfig): void {
  try {
    localStorage.setItem(PEER_HOST_KEY, JSON.stringify(config));
  } catch {
    // تجاهل
  }
}

export const PAIRING_PREFIX = "QFTV:";

export type PairingInfo = {
  peerId: string;
  passcode: string;
};

export function makePasscode(length = 6): string {
  const digits = "0123456789";
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += digits[Math.floor(Math.random() * digits.length)];
  }
  return output;
}

export function encodePairing(info: PairingInfo): string {
  return `${PAIRING_PREFIX}${info.peerId}:${info.passcode}`;
}

export function decodePairing(payload: string): PairingInfo | null {
  if (!payload.startsWith(PAIRING_PREFIX)) return null;
  const rest = payload.slice(PAIRING_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  if (separator <= 0) return null;
  const peerId = rest.slice(0, separator);
  const passcode = rest.slice(separator + 1);
  if (!peerId || !passcode) return null;
  return { peerId, passcode };
}

/**
 * حجم الشريحة: 256KB — الأداء المثبت تجريبياً (61MB خلال 18 ثانية).
 * (تجربة 64KB أظهرت تباطؤاً كارثياً — لا نستخدمها؛ حد رسالة DataChannel
 * في المتصفحات الحديثة يستوعب 256KB. تُعالج الأجهزة القديمة عبر مرونة
 * المرسل لاحقاً إن دعت الحاجة.)
 */
export const CHUNK_SIZE = 256 * 1024;

/** نبضة تقدم من المستقبِل كل هذا المقدار (~2MB) لإثبات أن الاتصال حي. */
const PROGRESS_PULSE_BYTES = 2 * 1024 * 1024;

/** تحديث التقدم على الأجهزة مُخفَّف لتجنب إعادة رسم متكررة (الأجهزة البطيئة). */
const PROGRESS_THROTTLE_MS = 120;

/** مهلة الخمول: إذا لم يصل أي نشاط من المستقبِل خلالها، يُعتبر النقل فاشلاً. */
export const IDLE_TIMEOUT_MS = 45_000;

/**
 * حارس مهلة الخمول: يُعيد ضبطه بأي نشاط (ping) ولا يُطلق النداء إلا عند
 * انتهاء الخمول الحقيقي. بديل معياري للمهل الثابتة المرتبطة بالحجم —
 * النقل الكبير يستمر طالما هناك تقدم فعلي.
 */
export function createIdleGuard(
  onIdle: () => void,
  idleTimeoutMs: number = IDLE_TIMEOUT_MS,
  checkIntervalMs = 1000,
): { ping: () => void; stop: () => void } {
  let lastActivity = Date.now();
  let settled = false;
  const timer = globalThis.setInterval(() => {
    if (!settled && Date.now() - lastActivity > idleTimeoutMs) {
      settled = true;
      globalThis.clearInterval(timer);
      onIdle();
    }
  }, checkIntervalMs);
  return {
    ping: () => {
      lastActivity = Date.now();
    },
    stop: () => {
      settled = true;
      globalThis.clearInterval(timer);
    },
  };
}

export type IncomingTransferFile = {
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
};

export type TransferProgress = {
  sent: number;
  total: number;
};

const HEADER_PREFIX = "header:";
const DONE_PREFIX = "done:";
const PROGRESS_PREFIX = "progress:";

export class FastReceiver {
  readonly peerId: string;
  readonly passcode: string;
  readonly payload: string;

  private readonly peer: { destroy(): void };
  private readonly onFile: (file: IncomingTransferFile) => void;
  private readonly onProgress: (received: number, total: number) => void;
  private readonly onStatus: (message: string) => void;
  private disposed = false;

  private constructor(
    peer: { destroy(): void },
    peerId: string,
    passcode: string,
    onFile: (file: IncomingTransferFile) => void,
    onProgress: (received: number, total: number) => void,
    onStatus: (message: string) => void,
  ) {
    this.peer = peer;
    this.peerId = peerId;
    this.passcode = passcode;
    this.payload = encodePairing({ peerId, passcode });
    this.onFile = onFile;
    this.onProgress = onProgress;
    this.onStatus = onStatus;
  }

  static async create(
    onFile: (file: IncomingTransferFile) => void,
    onProgress?: (received: number, total: number) => void,
    onStatus?: (message: string) => void,
  ): Promise<FastReceiver> {
    const { default: Peer } = await import("peerjs");
    const config = getPeerServerConfig();
    const passcode = makePasscode();
    const peer = new Peer({
      host: config.host,
      port: config.port,
      path: config.path,
      secure: config.secure,
      debug: 0,
    });
    const peerId = await new Promise<string>((resolve, reject) => {
      const onOpen = (id: string) => {
        peer.off("error", onError);
        resolve(id);
      };
      const onError = (error: unknown) => {
        peer.off("open", onOpen);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      peer.on("open", onOpen);
      peer.on("error", onError);
    });
    const receiver = new FastReceiver(
      peer,
      peerId,
      passcode,
      onFile,
      onProgress ?? (() => undefined),
      onStatus ?? (() => undefined),
    );
    peer.on("connection", (conn) => receiver.handleConnection(conn));
    return receiver;
  }

  private handleConnection(conn: unknown): void {
    const connection = conn as {
      peer: string;
      metadata?: { passcode?: string };
      on(event: "data" | "close" | "error", handler: (data?: unknown) => void): void;
      send(data: string): void;
      close(): void;
    };
    connection.on("error", () => undefined);
    connection.on("close", () => undefined);

    let buffer: Uint8Array | null = null;
    let received = 0;
    let total = 0;
    let lastProgressSent = 0;
    let lastProgressAt = 0;
    let header: { passcode: string; name: string; mime: string; size: number } | null = null;

    connection.on("data", (data) => {
      if (typeof data === "string") {
        if (data.startsWith(HEADER_PREFIX)) {
          try {
            const parsed = JSON.parse(data.slice(HEADER_PREFIX.length)) as {
              passcode: string;
              name: string;
              mime: string;
              size: number;
            };
            if (
              !connection.metadata ||
              connection.metadata.passcode !== parsed.passcode ||
              parsed.passcode !== this.passcode
            ) {
              connection.send("reject");
              connection.close();
              return;
            }
            header = parsed;
            total = parsed.size;
            buffer = new Uint8Array(total);
            received = 0;
            connection.send("ok");
            this.onStatus("استقبال الملف…");
          } catch {
            connection.send("reject");
          }
        } else if (data.startsWith(DONE_PREFIX) && buffer && header) {
          const expectedCrc = Number(data.slice(DONE_PREFIX.length));
          const actualCrc = crc32(buffer);
          if (actualCrc === expectedCrc) {
            connection.send("ack");
            const file: IncomingTransferFile = {
              name: header.name,
              mime: header.mime,
              size: header.size,
              bytes: buffer,
            };
            this.onStatus("اكتمل الاستقبال.");
            this.onFile(file);
          } else {
            connection.send("nack");
            this.onStatus("فشل المجموع الاختباري.");
          }
          buffer = null;
        } else if (data.startsWith(PROGRESS_PREFIX)) {
          // رسائل تقدم اختيارية من المرسل (تُتجاهل هنا)
        }
        return;
      }

      // شريحة بيانات ثنائية
      if (!buffer || !header) return;
      const chunk =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : null;
      if (!chunk) return;
      const remaining = total - received;
      const length = Math.min(chunk.length, remaining);
      buffer.set(chunk.subarray(0, length), received);
      received += length;
      // تحديث التقدم مُخفَّف: لا نعيد رسم الواجهة لكل شريحة (يصل إلى 244
      // شريحة لملف 61MB). نحدّث كل PROGRESS_THROTTLE_MS ونضمن آخر تحديث.
      const now = Date.now();
      if (
        now - lastProgressAt >= PROGRESS_THROTTLE_MS ||
        received >= total
      ) {
        lastProgressAt = now;
        this.onProgress(received, total);
      }
      // نبضة تقدم دورية: تثبت للمرسل أن الاستقبال يتقدم والاتصال حي
      if (received - lastProgressSent >= PROGRESS_PULSE_BYTES) {
        lastProgressSent = received;
        try {
          connection.send(`${PROGRESS_PREFIX}${received}`);
        } catch {
          // تجاهل فشل النبضة — لا يوقف الاستقبال
        }
      }
    });
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.peer.destroy();
    } catch {
      // تجاهل
    }
  }
}

export type FastSenderOptions = {
  pairing: PairingInfo;
  file: { name: string; mime: string; bytes: Uint8Array };
  onProgress?: (progress: TransferProgress) => void;
  onStatus?: (message: string) => void;
};

/**
 * يرسل ملفاً إلى مستقبِل (تلفزيون/جهاز) عبر قناة P2P. يعيد وعداً يتحقق عند
 * نجاح النقل الكامل، أو يرفض بخطأ واضح عند أي فشل.
 */
export async function sendFileFast(options: FastSenderOptions): Promise<void> {
  const { default: Peer } = await import("peerjs");
  const config = getPeerServerConfig();
  const onStatus = options.onStatus ?? (() => undefined);

  const peer = new Peer({
    host: config.host,
    port: config.port,
    path: config.path,
    secure: config.secure,
    debug: 0,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        peer.off("error", onError);
        resolve();
      };
      const onError = (error: unknown) => {
        peer.off("open", onOpen);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      peer.on("open", onOpen);
      peer.on("error", onError);
    });

    const connection = peer.connect(options.pairing.peerId, {
      metadata: { passcode: options.pairing.passcode },
      serialization: "binary",
      reliable: true,
    } as never);

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("تعذّر الاتصال بالمستقبِل. تأكد أن الجهازين على نفس الشبكة.")),
        20_000,
      );
      connection.on("open", () => {
        window.clearTimeout(timer);
        resolve();
      });
      connection.on("error", (error) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    // إرسال الترويسة
    connection.send(
      `${HEADER_PREFIX}${JSON.stringify({
        passcode: options.pairing.passcode,
        name: options.file.name,
        mime: options.file.mime,
        size: options.file.bytes.length,
      })}`,
    );

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("المستقبِل لم يقبل الاتصال (رمز اقتران غير صالح).")),
        15_000,
      );
      connection.on("data", (data) => {
        if (data === "ok") {
          window.clearTimeout(timer);
          resolve();
        } else if (data === "reject") {
          window.clearTimeout(timer);
          reject(new Error("رفض المستقبِل الاتصال. أعد فتح صفحة الاستقبال."));
        }
      });
      connection.on("close", () => reject(new Error("أُغلق الاتصال قبل القبول.")));
    });

    // إرسال الشرائح مع مراقبة خمول موحّدة عبر حارس خمول:
    // - أي نشاط (نبضة تقدم/ack/أي رسالة) من المستقبِل يعيد ضبط الحارس (ping).
    // - لا مهلة ثابتة مرتبطة بحجم الملف — النقل يستمر ما دام هناك تقدم فعلي.
    // - عند الخمول الحقيقي (انقطاع الشبكة) يُفشل بخطأ دقيق بعد IDLE_TIMEOUT_MS.
    const bytes = options.file.bytes;
    const total = bytes.length;
    let settled = false;
    let resolveTransfer: () => void = () => undefined;
    let rejectTransfer: (error: Error) => void = () => undefined;

    // Promise واحد يغطي كامل مراحل الإرسال والتحقق
    const completion = new Promise<void>((resolve, reject) => {
      resolveTransfer = resolve;
      rejectTransfer = reject;
    });

    // مرجع لدالة الحسم يُملأ لاحقاً (يستخدمه حارس الخمول عبر closure)
    // eslint-disable-next-line prefer-const
    let finishRef: ((message?: string) => void) | undefined;

    // حارس الخمول: يُطلق النداء فقط عند انقطاع فعلي بلا أي نشاط
    const idleGuard = createIdleGuard(() => {
      finishRef?.(
        `انقطع الاتصال بالمستقبِل بعد إرسال ${total.toLocaleString()} بايت (لا توجد استجابة). أعد المحاولة.`,
      );
    });

    const finish = (message?: string) => {
      if (settled) return;
      settled = true;
      idleGuard.stop();
      if (message) rejectTransfer(new Error(message));
      else resolveTransfer();
    };
    finishRef = finish;

    // معالج عام لأي رسالة واردة من المستقبِل (يعمل بالتوازي مع حلقة الإرسال)
    const onData = (data: unknown) => {
      if (settled) return;
      idleGuard.ping();
      if (data === "ack") {
        finish();
      } else if (data === "nack") {
        finish("فشل التحقق من الملف لدى المستقبِل. أعد المحاولة.");
      }
      // نبضات التقدم وغيرها: تُحدّث النشاط فقط
    };
    connection.on("data", onData);
    const onClose = () => {
      finish(
        `أُغلق الاتصال بالمستقبِل بعد إرسال ${total.toLocaleString()} بايت. أعد المحاولة.`,
      );
    };
    connection.on("close", onClose);

    onStatus("جارٍ الإرسال…");
    let lastProgressAt = 0;
    for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
      if (settled) break;
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, total));
      // PeerJS يطبق ضغطاً خلفياً داخلياً (bufferedAmount) — send يتوقف حتى يتاح المخزن
      await connection.send(chunk as unknown as ArrayBuffer);
      if (settled) break;
      // تحديث التقدم مُخفَّف (لا لكل شريحة) مع ضمان آخر تحديث
      const now = Date.now();
      const sent = Math.min(offset + chunk.length, total);
      if (now - lastProgressAt >= 100 || sent >= total) {
        lastProgressAt = now;
        options.onProgress?.({ sent, total });
      }
    }

    // إعلان الاكتمال والتحقق (بعد اكتمال الحلقة دون حسم مسبق)
    if (!settled) {
      try {
        connection.send(`${DONE_PREFIX}${crc32(bytes)}`);
      } catch {
        finish("فشل إرسال رسالة الاكتمال إلى المستقبِل.");
      }
    }

    // ننتظر ack (أو حارس الخمول/close) — لا مهلة ثابتة
    await completion;

    onStatus("اكتمل الإرسال.");
  } finally {
    try {
      peer.destroy();
    } catch {
      // تجاهل
    }
  }
}

/**
 * قناة جسر QRFerry: مصادقة + شات + نقل ملفات في الاتجاهين فوق قناة WebRTC واحدة.
 *
 * ## المصادقة (3 رسائل)
 *   المضيف → hello   { n: hostNonce }
 *   الضيف  → auth    { n: joinerNonce, m: proof(joiner) }
 *   المضيف → welcome { m: proof(host) }   (أو denied / busy)
 *
 * ## بروتوكول الملفات (لكل اتجاه تسلسل مستقل)
 *   المُرسِل  → file-start { id, name, mime, size }
 *   المستقبِل → file-go    { id }            (أو file-ack { id, ok:false, reason })
 *   المُرسِل  → [شرائح ثنائية 256KB]
 *   المستقبِل → file-progress { id, received }   (نبضة كل ~2MB)
 *   المُرسِل  → file-end { id, crc }
 *   المستقبِل → file-ack { id, ok, reason? }      (ok بعد التحقق من الحجم و CRC)
 *
 * ## قواعد الأمان
 *  - لا تُعالَج أي رسالة قبل نجاح المصادقة (ما عدا hello/auth/welcome).
 *  - كل الرسائل تُعالج بالتسلسل عبر سلسلة promises: لا سباق بين التحقق والبيانات.
 *  - أي انتهاك للبروتوكول (ترتيب خاطئ، حجم زائد، حقل غير صالح) يغلق القناة.
 *  - كل حقل وارد يُتحقَّق منه قبل استخدامه (نوع، طول، نطاق).
 *
 * الملف لا يعتمد على DOM ولا على PeerJS مباشرة: يعمل مع أي كائن يطابق
 * BridgeConnectionLike، ولهذا تُختبر كل مساراته في Node.
 */

import { MAX_FILE_BYTES } from "./optical-transfer";
import { createIdleGuard, CHUNK_SIZE, IDLE_TIMEOUT_MS } from "./fast-transfer";
import {
  bridgeTranscript,
  computeBridgeProof,
  dtlsFingerprintsFromSdp,
  generateBridgeId,
  generateBridgeNonce,
  isBridgeNonce,
  verifyBridgeProof,
  type BridgeRole,
} from "./bridge-auth";

export type { BridgeRole } from "./bridge-auth";

export const BRIDGE_MAX_CHAT_CHARS = 4000;
export const BRIDGE_MAX_NAME_CHARS = 255;
export const BRIDGE_MAX_MIME_CHARS = 127;
export const BRIDGE_HANDSHAKE_TIMEOUT_MS = 20_000;
/** نبضة تقدم من المستقبِل كل هذا العدد من البايتات (يثبت أن القناة حية). */
export const BRIDGE_PROGRESS_PULSE_BYTES = 2 * 1024 * 1024;
const PROGRESS_THROTTLE_MS = 150;
const ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

export type BridgeStatus =
  | "authenticating"
  | "connected"
  | "denied"
  | "busy"
  | "closed"
  | "failed";

export type BridgeChatMessage = {
  kind: "chat";
  id: string;
  direction: "in" | "out";
  text: string;
  at: number;
};

export type BridgeFileStatus =
  | "queued"
  | "waiting"
  | "sending"
  | "receiving"
  | "done"
  | "failed";

export type BridgeFileItem = {
  kind: "file";
  id: string;
  direction: "in" | "out";
  name: string;
  mime: string;
  size: number;
  status: BridgeFileStatus;
  progress: number;
  error?: string;
  at: number;
  /** يُملأ فقط للملفات المستلمة بعد التحقق الكامل. */
  bytes?: Uint8Array;
};

export type BridgeOutgoingFile = {
  name: string;
  mime: string;
  bytes: Uint8Array;
};

export type BridgeCallbacks = {
  onStatus(status: BridgeStatus, detail?: string): void;
  onChat(message: BridgeChatMessage): void;
  onFile(item: BridgeFileItem): void;
};

/** الحد الأدنى من واجهة الاتصال المطلوبة (تطابق DataConnection في PeerJS). */
export type BridgeConnectionLike = {
  readonly open?: boolean;
  send(data: unknown): unknown;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  close(): void;
  peerConnection?: {
    localDescription?: { sdp?: string | null } | null;
    remoteDescription?: { sdp?: string | null } | null;
  } | null;
};

type ControlMessage = Record<string, unknown> & { t: string };

class BridgeProtocolError extends Error {}

type Timer = ReturnType<typeof setTimeout>;

function schedule(callback: () => void, ms: number): Timer {
  const timer = setTimeout(callback, ms);
  // لا يُبقي عملية Node حيّة (الاختبارات) — no-op في المتصفح.
  (timer as unknown as { unref?: () => void }).unref?.();
  return timer;
}

// ---------------------------------------------------------------------------
// CRC-32 تزايدي بجدول (أسرع بكثير من الحلقة البتية لملفات بحجم مئات MB).
// متوافق تماماً مع crc32 في optical-transfer (نفس الكثير المعياري).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Start(): number {
  return 0xffffffff;
}

export function crc32Feed(state: number, bytes: Uint8Array): number {
  let c = state;
  for (let index = 0; index < bytes.length; index += 1) {
    c = CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  }
  return c;
}

export function crc32Finish(state: number): number {
  return (state ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------

type OutgoingJob = {
  id: string;
  file: BridgeOutgoingFile;
  item: BridgeFileItem;
};

type IncomingFile = {
  id: string;
  item: BridgeFileItem;
  buffer: Uint8Array;
  received: number;
  crc: number;
  guard: ReturnType<typeof createIdleGuard>;
  lastEmit: number;
  lastPulse: number;
};

type PeerWaiter = {
  id: string;
  expected: readonly string[];
  resolve(message: ControlMessage): void;
  reject(error: Error): void;
  ping(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isSafeText(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxChars
  );
}

function isSafeSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_FILE_BYTES
  );
}

function isCrc(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
  );
}

export class BridgeChannel {
  private state: "handshake" | "ready" | "closed" = "handshake";
  private started = false;
  private hostNonce = "";
  private joinerNonce = "";
  private handshakeTimer: Timer | undefined;
  private inbox: Promise<void> = Promise.resolve();
  private incoming: IncomingFile | null = null;
  private outgoing: OutgoingJob[] = [];
  private pumping = false;
  private streamGuard: ReturnType<typeof createIdleGuard> | null = null;
  private waiter: PeerWaiter | null = null;
  private readonly closedSignal: Promise<void>;
  private resolveClosed: () => void = () => undefined;
  private lastProgressEmit = 0;
  /** المهمة الجارية للمُرسِل (تُضبط أثناء النقل فقط). */
  private outgoingInFlight: OutgoingJob | null = null;

  constructor(
    private readonly conn: BridgeConnectionLike,
    private readonly role: BridgeRole,
    private readonly key: CryptoKey,
    private readonly callbacks: BridgeCallbacks,
  ) {
    this.closedSignal = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    conn.on("data", (data) => this.receive(data));
    conn.on("close", () => this.fail("انقطع الاتصال.", "closed"));
    conn.on("error", () => this.fail("حدث خطأ في الاتصال.", "failed"));
    if (conn.open) {
      this.beginHandshake();
    } else {
      conn.on("open", () => this.beginHandshake());
    }
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  get isClosed(): boolean {
    return this.state === "closed";
  }

  /** إغلاق يدوي من المستخدم. */
  close(detail = "أغلقت الجلسة."): void {
    this.fail(detail, "closed");
  }

  /** إنهاء فوري بسبب خارجي (مثلاً فشل إنشاء الـ peer). */
  abort(detail: string, status: BridgeStatus = "failed"): void {
    this.fail(detail, status);
  }

  sendChat(text: string): string {
    if (this.state !== "ready") throw new Error("الجلسة غير متصلة بعد.");
    const trimmed = text.trim();
    if (!isSafeText(trimmed, BRIDGE_MAX_CHAT_CHARS)) {
      throw new Error("نص الرسالة فارغ أو أطول من المسموح.");
    }
    const id = generateBridgeId();
    this.sendControl({ t: "chat", id, text: trimmed });
    this.callbacks.onChat({
      kind: "chat",
      id,
      direction: "out",
      text: trimmed,
      at: Date.now(),
    });
    return id;
  }

  sendFile(file: BridgeOutgoingFile): string {
    if (this.state !== "ready") throw new Error("الجلسة غير متصلة بعد.");
    const name = file.name.trim() || "transfer.bin";
    if (name.length > BRIDGE_MAX_NAME_CHARS) {
      throw new Error("اسم الملف طويل جداً.");
    }
    if (!isSafeSize(file.bytes.length)) {
      throw new Error("حجم الملف يتجاوز الحد المسموح (512 MB).");
    }
    const mime = (file.mime || "application/octet-stream").slice(
      0,
      BRIDGE_MAX_MIME_CHARS,
    );
    const id = generateBridgeId();
    const item: BridgeFileItem = {
      kind: "file",
      id,
      direction: "out",
      name,
      mime,
      size: file.bytes.length,
      status: "queued",
      progress: 0,
      at: Date.now(),
    };
    this.outgoing.push({
      id,
      file: { name, mime, bytes: file.bytes },
      item,
    });
    this.callbacks.onFile({ ...item });
    void this.pump();
    return id;
  }

  // -------------------------------------------------------------------------
  // دورة الحياة
  // -------------------------------------------------------------------------

  private beginHandshake(): void {
    if (this.started || this.state !== "handshake") return;
    this.started = true;
    this.callbacks.onStatus("authenticating");
    this.handshakeTimer = schedule(() => {
      this.fail("انتهت مهلة المصادقة مع الجهاز الآخر.", "failed");
    }, BRIDGE_HANDSHAKE_TIMEOUT_MS);
    if (this.role === "host") {
      this.hostNonce = generateBridgeNonce();
      this.sendControl({ t: "hello", v: 1, n: this.hostNonce });
    }
  }

  private becomeReady(): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.state = "ready";
    this.callbacks.onStatus("connected");
    void this.pump();
  }

  private fail(detail: string, status: BridgeStatus): void {
    if (this.state === "closed") return;
    this.state = "closed";
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.resolveClosed();

    const failure = new Error(detail);
    if (this.incoming) {
      this.incoming.guard.stop();
      this.emitFile(this.incoming.item, {
        status: "failed",
        error: detail,
      });
      this.incoming = null;
    }
    this.streamGuard?.stop();
    this.streamGuard = null;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(failure);
    for (const job of this.outgoing) {
      this.emitFile(job.item, { status: "failed", error: detail });
    }
    this.outgoing = [];

    this.callbacks.onStatus(status, detail);
    // المضيف والضيف يرسلان رفضاً قبل الإغلاق: نمنح الرسالة مهلة للوصول.
    const delayClose = status === "denied" || status === "busy";
    if (delayClose) {
      schedule(() => this.closeConnection(), 400);
    } else {
      this.closeConnection();
    }
  }

  private closeConnection(): void {
    try {
      this.conn.close();
    } catch {
      // الاتصال مغلق مسبقاً.
    }
  }

  // -------------------------------------------------------------------------
  // استقبال البيانات (تسلسلي)
  // -------------------------------------------------------------------------

  private receive(data: unknown): void {
    if (this.state === "closed") return;
    this.inbox = this.inbox
      .then(() => this.process(data))
      .catch((cause: unknown) => {
        const message =
          cause instanceof Error && cause.message
            ? cause.message
            : "بروتوكول غير صالح من الجهاز الآخر.";
        this.fail(message, "failed");
      });
  }

  private async process(data: unknown): Promise<void> {
    if (this.state === "closed") return;
    if (typeof data === "string") {
      const message = this.parseControl(data);
      this.waiter?.ping();
      if (this.state === "handshake") {
        await this.handleHandshake(message);
      } else {
        this.handleControl(message);
      }
      return;
    }
    const chunk =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : null;
    if (!chunk) throw new BridgeProtocolError("صيغة بيانات غير مدعومة.");
    if (this.state !== "ready") {
      throw new BridgeProtocolError("وصلت بيانات قبل اكتمال المصادقة.");
    }
    this.handleChunk(chunk);
  }

  private parseControl(raw: string): ControlMessage {
    if (raw.length > 8192) throw new BridgeProtocolError("رسالة أكبر من المسموح.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BridgeProtocolError("رسالة تحكم غير صالحة.");
    }
    if (!isRecord(parsed) || typeof parsed.t !== "string") {
      throw new BridgeProtocolError("رسالة تحكم غير صالحة.");
    }
    return parsed as ControlMessage;
  }

  private sendControl(message: Record<string, unknown>): void {
    this.transmit(JSON.stringify(message)).catch(() => undefined);
  }

  /**
   * إرسال موحّد: PeerJS قد يُرجع Promise يُرفض عند إغلاق القناة.
   * أي فشل يُغلق الجلسة بوضوح بدل أن يبقى معلّقاً.
   */
  private transmit(data: unknown): Promise<void> {
    const onFailure = (error: unknown): never => {
      this.fail("تعذّر إرسال البيانات إلى الجهاز الآخر.", "failed");
      throw error;
    };
    try {
      const result = this.conn.send(data);
      if (result && typeof (result as Promise<void>).then === "function") {
        return (result as Promise<void>).then(() => undefined, onFailure);
      }
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(onFailure(error));
    }
  }

  // -------------------------------------------------------------------------
  // المصادقة
  // -------------------------------------------------------------------------

  private fingerprints(): { host: string; joiner: string } {
    const local = dtlsFingerprintsFromSdp(
      this.conn.peerConnection?.localDescription?.sdp,
    );
    const remote = dtlsFingerprintsFromSdp(
      this.conn.peerConnection?.remoteDescription?.sdp,
    );
    if (!local || !remote) {
      throw new BridgeProtocolError("تعذّر التحقق من قناة الاتصال المشفّرة.");
    }
    return this.role === "host"
      ? { host: local, joiner: remote }
      : { host: remote, joiner: local };
  }

  private async handleHandshake(message: ControlMessage): Promise<void> {
    if (this.role === "joiner") {
      if (message.t === "busy") {
        this.fail("الكمبيوتر متصل بجهاز آخر الآن.", "busy");
        return;
      }
      if (message.t === "denied") {
        this.fail("رفض الجهاز الآخر الاتصال: رمز الربط غير صحيح.", "denied");
        return;
      }
      if (message.t === "hello") {
        if (message.v !== 1 || !isBridgeNonce(message.n)) {
          throw new BridgeProtocolError("ترويسة مصادقة غير صالحة.");
        }
        this.hostNonce = message.n;
        this.joinerNonce = generateBridgeNonce();
        const prints = this.fingerprints();
        const transcript = bridgeTranscript({
          hostFingerprint: prints.host,
          joinerFingerprint: prints.joiner,
          hostNonce: this.hostNonce,
          joinerNonce: this.joinerNonce,
        });
        const proof = await computeBridgeProof(this.key, "joiner", transcript);
        this.sendControl({ t: "auth", n: this.joinerNonce, m: proof });
        return;
      }
      if (message.t === "welcome") {
        if (!this.hostNonce || !this.joinerNonce) {
          throw new BridgeProtocolError("ترتيب المصادقة غير صالح.");
        }
        const prints = this.fingerprints();
        const transcript = bridgeTranscript({
          hostFingerprint: prints.host,
          joinerFingerprint: prints.joiner,
          hostNonce: this.hostNonce,
          joinerNonce: this.joinerNonce,
        });
        const ok = await verifyBridgeProof(
          this.key,
          "host",
          transcript,
          message.m,
        );
        if (!ok) {
          this.fail(
            "فشل التحقق من هوية الكمبيوتر — تأكد أنك مسحت الرمز المعروض الآن.",
            "failed",
          );
          return;
        }
        this.becomeReady();
        return;
      }
      throw new BridgeProtocolError("رسالة مصادقة غير متوقعة.");
    }

    // المضيف: ينتظر auth من الضيف.
    if (message.t !== "auth") {
      throw new BridgeProtocolError("رسالة مصادقة غير متوقعة.");
    }
    if (!isBridgeNonce(message.n)) {
      throw new BridgeProtocolError("ترويسة مصادقة غير صالحة.");
    }
    this.joinerNonce = message.n;
    const prints = this.fingerprints();
    const transcript = bridgeTranscript({
      hostFingerprint: prints.host,
      joinerFingerprint: prints.joiner,
      hostNonce: this.hostNonce,
      joinerNonce: this.joinerNonce,
    });
    const ok = await verifyBridgeProof(
      this.key,
      "joiner",
      transcript,
      message.m,
    );
    if (!ok) {
      this.sendControl({ t: "denied" });
      this.fail("رمز ربط غير صحيح من جهاز آخر.", "denied");
      return;
    }
    const proof = await computeBridgeProof(this.key, "host", transcript);
    this.sendControl({ t: "welcome", m: proof });
    this.becomeReady();
  }

  // -------------------------------------------------------------------------
  // رسائل ما بعد المصادقة
  // -------------------------------------------------------------------------

  private handleControl(message: ControlMessage): void {
    switch (message.t) {
      case "chat":
        this.onRemoteChat(message);
        return;
      case "file-start":
        this.onRemoteFileStart(message);
        return;
      case "file-end":
        this.onRemoteFileEnd(message);
        return;
      case "file-progress":
        this.onRemoteProgress(message);
        return;
      case "file-go":
      case "file-ack":
        this.routeToWaiter(message);
        return;
      default:
        throw new BridgeProtocolError("نوع رسالة غير معروف.");
    }
  }

  private routeToWaiter(message: ControlMessage): void {
    const waiter = this.waiter;
    // ردّ متأخر على ملف انتهت مهلته: يُتجاهل دون إغلاق القناة.
    if (!waiter || message.id !== waiter.id) return;
    if (!waiter.expected.includes(message.t)) {
      throw new BridgeProtocolError("ترتيب ردود الملفات غير صالح.");
    }
    waiter.resolve(message);
  }

  private onRemoteChat(message: ControlMessage): void {
    if (!isSafeId(message.id) || !isSafeText(message.text, BRIDGE_MAX_CHAT_CHARS)) {
      throw new BridgeProtocolError("رسالة نصية غير صالحة.");
    }
    this.callbacks.onChat({
      kind: "chat",
      id: message.id,
      direction: "in",
      text: message.text,
      at: Date.now(),
    });
  }

  private onRemoteProgress(message: ControlMessage): void {
    const sender = this.outgoingInFlight;
    if (!sender || message.id !== sender.id) return;
    if (typeof message.received !== "number") return;
    const received = Math.min(message.received, sender.item.size);
    this.streamGuard?.ping();
    const now = Date.now();
    if (now - this.lastProgressEmit >= PROGRESS_THROTTLE_MS) {
      this.lastProgressEmit = now;
      this.emitFile(sender.item, { progress: received });
    }
  }

  private onRemoteFileStart(message: ControlMessage): void {
    if (!isSafeId(message.id)) {
      throw new BridgeProtocolError("معرّف ملف غير صالح.");
    }
    if (
      typeof message.name !== "string" ||
      !isSafeText(message.name, BRIDGE_MAX_NAME_CHARS) ||
      typeof message.mime !== "string" ||
      message.mime.length > BRIDGE_MAX_MIME_CHARS ||
      !isSafeSize(message.size)
    ) {
      throw new BridgeProtocolError("بيانات ملف غير صالحة.");
    }
    if (this.incoming) {
      // لا يُرسل المُرسِل ملفين معاً؛ نرفض الثاني بلطف دون إغلاق القناة.
      this.sendControl({
        t: "file-ack",
        id: message.id,
        ok: false,
        reason: "busy",
      });
      return;
    }

    const size = message.size;
    const item: BridgeFileItem = {
      kind: "file",
      id: message.id,
      direction: "in",
      name: message.name,
      mime: message.mime || "application/octet-stream",
      size,
      status: "receiving",
      progress: 0,
      at: Date.now(),
    };
    const guard = createIdleGuard(() => {
      this.fail("توقف استقبال الملف قبل اكتماله.", "failed");
    }, IDLE_TIMEOUT_MS);
    this.incoming = {
      id: message.id,
      item,
      buffer: new Uint8Array(size),
      received: 0,
      crc: crc32Start(),
      guard,
      lastEmit: 0,
      lastPulse: 0,
    };
    this.callbacks.onFile({ ...item });
    this.sendControl({ t: "file-go", id: message.id });
  }

  private handleChunk(chunk: Uint8Array): void {
    const current = this.incoming;
    if (!current) {
      throw new BridgeProtocolError("وصلت بيانات ملف بلا ترويسة.");
    }
    if (current.received + chunk.byteLength > current.buffer.length) {
      throw new BridgeProtocolError("وصلت بيانات تتجاوز حجم الملف المعلن.");
    }
    current.buffer.set(chunk, current.received);
    current.received += chunk.byteLength;
    current.crc = crc32Feed(current.crc, chunk);
    current.guard.ping();

    const now = Date.now();
    if (now - current.lastEmit >= PROGRESS_THROTTLE_MS) {
      current.lastEmit = now;
      this.emitFile(current.item, { progress: current.received });
    }
    if (current.received - current.lastPulse >= BRIDGE_PROGRESS_PULSE_BYTES) {
      current.lastPulse = current.received;
      this.sendControl({
        t: "file-progress",
        id: current.id,
        received: current.received,
      });
    }
  }

  private onRemoteFileEnd(message: ControlMessage): void {
    const current = this.incoming;
    if (!current || message.id !== current.id) {
      throw new BridgeProtocolError("إنهاء ملف غير متوقع.");
    }
    if (!isCrc(message.crc)) {
      throw new BridgeProtocolError("مجموع اختباري غير صالح.");
    }
    current.guard.stop();
    this.incoming = null;

    const complete = current.received === current.buffer.length;
    const checksum = crc32Finish(current.crc);
    if (!complete) {
      this.emitFile(current.item, {
        status: "failed",
        error: "الملف ناقص: لم تصل كل البايتات.",
      });
      this.sendControl({
        t: "file-ack",
        id: current.id,
        ok: false,
        reason: "incomplete",
      });
      return;
    }
    if (checksum !== message.crc) {
      this.emitFile(current.item, {
        status: "failed",
        error: "فشل المجموع الاختباري للملف.",
      });
      this.sendControl({
        t: "file-ack",
        id: current.id,
        ok: false,
        reason: "checksum",
      });
      return;
    }
    this.emitFile(current.item, {
      status: "done",
      progress: current.buffer.length,
      bytes: current.buffer,
    });
    this.sendControl({ t: "file-ack", id: current.id, ok: true });
  }

  // -------------------------------------------------------------------------
  // إرسال الملفات (طابور تسلسلي)
  // -------------------------------------------------------------------------

  private emitFile(
    item: BridgeFileItem,
    patch: Partial<BridgeFileItem>,
  ): void {
    Object.assign(item, patch);
    this.callbacks.onFile({ ...item });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.state === "ready" && this.outgoing.length > 0) {
        const job = this.outgoing.shift();
        if (!job) break;
        await this.runOutgoing(job);
      }
    } finally {
      this.pumping = false;
    }
  }

  private waitForPeer(
    id: string,
    expected: readonly string[],
  ): Promise<ControlMessage> {
    return new Promise<ControlMessage>((resolve, reject) => {
      const guard = createIdleGuard(() => {
        this.waiter = null;
        reject(new Error("لم يردّ الجهاز الآخر — توقف الاتصال."));
      }, IDLE_TIMEOUT_MS);
      this.waiter = {
        id,
        expected,
        resolve: (message) => {
          guard.stop();
          this.waiter = null;
          resolve(message);
        },
        reject: (error) => {
          guard.stop();
          this.waiter = null;
          reject(error);
        },
        ping: () => guard.ping(),
      };
    });
  }

  private async runOutgoing(job: OutgoingJob): Promise<void> {
    const { id, file, item } = job;
    this.outgoingInFlight = job;
    try {
      this.emitFile(item, { status: "waiting" });
      this.sendControl({
        t: "file-start",
        id,
        name: file.name,
        mime: file.mime,
        size: file.bytes.length,
      });

      const reply = await this.waitForPeer(id, ["file-go", "file-ack"]);
      if (reply.t === "file-ack") {
        this.emitFile(item, {
          status: "failed",
          error: rejectionText(reply.reason),
        });
        return;
      }

      this.emitFile(item, { status: "sending", progress: 0 });
      const bytes = file.bytes;
      let crc = crc32Start();
      const guard = createIdleGuard(() => {
        this.fail("توقف الجهاز الآخر أثناء استقبال الملف.", "failed");
      }, IDLE_TIMEOUT_MS);
      this.streamGuard = guard;
      try {
        let lastEmit = 0;
        for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
          if (this.state !== "ready") {
            throw new Error("انقطع الاتصال أثناء الإرسال.");
          }
          const chunk = bytes.subarray(
            offset,
            Math.min(offset + CHUNK_SIZE, bytes.length),
          );
          crc = crc32Feed(crc, chunk);
          // سباق مع الإغلاق: لو انقطعت القناة أثناء انتظار المخزن لا نبقى معلّقين.
          await Promise.race([this.transmit(chunk), this.closedSignal]);
          const now = Date.now();
          if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
            lastEmit = now;
            this.emitFile(item, {
              progress: Math.min(offset + chunk.length, bytes.length),
            });
          }
        }
        if (this.state !== "ready") {
          throw new Error("انقطع الاتصال أثناء الإرسال.");
        }
        this.sendControl({ t: "file-end", id, crc: crc32Finish(crc) });
      } finally {
        guard.stop();
        if (this.streamGuard === guard) this.streamGuard = null;
      }

      const ack = await this.waitForPeer(id, ["file-ack"]);
      if (ack.ok === true) {
        this.emitFile(item, { status: "done", progress: bytes.length });
      } else {
        this.emitFile(item, {
          status: "failed",
          error: rejectionText(ack.reason),
        });
      }
    } catch (cause) {
      if (item.status !== "failed" && item.status !== "done") {
        this.emitFile(item, {
          status: "failed",
          error:
            cause instanceof Error && cause.message
              ? cause.message
              : "فشل إرسال الملف.",
        });
      }
    } finally {
      this.outgoingInFlight = null;
    }
  }

  /** يعيد Promise يُحلّ عند إغلاق القناة (لاستخدامه في سباقات الإرسال). */
  get whenClosed(): Promise<void> {
    return this.closedSignal;
  }
}

function rejectionText(reason: unknown): string {
  switch (reason) {
    case "busy":
      return "الجهاز الآخر يستقبل ملفاً آخر الآن.";
    case "checksum":
      return "فشل التحقق من الملف لدى الجهاز الآخر. أعد المحاولة.";
    case "incomplete":
      return "وصل الملف ناقصاً إلى الجهاز الآخر. أعد المحاولة.";
    default:
      return "رفض الجهاز الآخر الملف.";
  }
}

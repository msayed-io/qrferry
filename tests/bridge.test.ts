import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  bridgeTranscript,
  computeBridgeProof,
  dtlsFingerprintsFromSdp,
  generateBridgeSecret,
  importBridgeKey,
  verifyBridgeProof,
  base64UrlEncode,
} from "../lib/bridge-auth";
import {
  bridgeShareUrl,
  decodeBridgePairing,
  encodeBridgePairing,
  BRIDGE_PREFIX,
  type BridgePairing,
} from "../lib/bridge-pairing";
import {
  BridgeChannel,
  BRIDGE_MAX_CHAT_CHARS,
  crc32Feed,
  crc32Finish,
  crc32Start,
  type BridgeCallbacks,
  type BridgeChatMessage,
  type BridgeConnectionLike,
  type BridgeFileItem,
  type BridgeStatus,
} from "../lib/bridge-channel";
import { crc32 } from "../lib/optical-transfer";

// ---------------------------------------------------------------------------
// قناة محاكاة: جهازان متصلان بقناة ثنائية الاتجاه تحافظ على الترتيب.
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

class FakeConnection implements BridgeConnectionLike {
  open = false;
  closed = false;
  other!: FakeConnection;
  peerConnection: BridgeConnectionLike["peerConnection"];
  /** يسمح باختبار التلاعب: يُستدعى قبل تسليم كل رسالة صادرة. */
  tamper?: (data: unknown) => unknown;
  private readonly handlers = new Map<string, Handler[]>();

  constructor(sdpLocal: string, sdpRemote: string) {
    this.peerConnection = {
      localDescription: { sdp: sdpFor(sdpLocal) },
      remoteDescription: { sdp: sdpFor(sdpRemote) },
    };
  }

  on(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  send(data: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error("القناة مغلقة."));
    const copy =
      data instanceof Uint8Array ? new Uint8Array(data) : (data as unknown);
    const delivered = this.tamper ? this.tamper(copy) : copy;
    const target = this.other;
    setImmediate(() => target.emit("data", delivered));
    return Promise.resolve();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.other.closed = true;
    this.other.open = false;
    setImmediate(() => {
      this.emit("close");
      this.other.emit("close");
    });
  }

  openNow(): void {
    this.open = true;
    this.emit("open");
  }
}

function fingerprintFor(seed: number): string {
  const parts: string[] = [];
  for (let index = 0; index < 32; index += 1) {
    const value = (seed * 31 + index * 7) & 0xff;
    parts.push(value.toString(16).toUpperCase().padStart(2, "0"));
  }
  return parts.join(":");
}

function sdpFor(fingerprint: string): string {
  return `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;
}

const FP_HOST = fingerprintFor(11);
const FP_JOINER = fingerprintFor(42);
const FP_ATTACKER = fingerprintFor(99);

type Recorder = {
  statuses: Array<{ status: BridgeStatus; detail?: string }>;
  chats: BridgeChatMessage[];
  files: Map<string, BridgeFileItem>;
  callbacks: BridgeCallbacks;
  lastStatus(): BridgeStatus | undefined;
};

function recorder(): Recorder {
  const statuses: Recorder["statuses"] = [];
  const chats: BridgeChatMessage[] = [];
  const files = new Map<string, BridgeFileItem>();
  return {
    statuses,
    chats,
    files,
    callbacks: {
      onStatus(status, detail) {
        statuses.push({ status, detail });
      },
      onChat(message) {
        chats.push(message);
      },
      onFile(item) {
        files.set(`${item.direction}:${item.id}`, item);
      },
    },
    lastStatus() {
      return statuses.at(-1)?.status;
    },
  };
}

async function until(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`انتهت المهلة: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65536) {
    crypto.getRandomValues(
      bytes.subarray(offset, Math.min(offset + 65536, length)),
    );
  }
  return bytes;
}

type Session = {
  host: BridgeChannel;
  joiner: BridgeChannel;
  hostConn: FakeConnection;
  joinerConn: FakeConnection;
  hostEvents: Recorder;
  joinerEvents: Recorder;
};

const openChannels: BridgeChannel[] = [];

afterEach(() => {
  for (const channel of openChannels.splice(0)) channel.close("نهاية الاختبار");
});

async function connect(options: {
  hostSecret?: string;
  joinerSecret?: string;
  hostRemoteFingerprint?: string;
  joinerRemoteFingerprint?: string;
}): Promise<Session> {
  const hostSecret = options.hostSecret ?? generateBridgeSecret();
  const joinerSecret = options.joinerSecret ?? hostSecret;
  const hostConn = new FakeConnection(
    FP_HOST,
    options.hostRemoteFingerprint ?? FP_JOINER,
  );
  const joinerConn = new FakeConnection(
    FP_JOINER,
    options.joinerRemoteFingerprint ?? FP_HOST,
  );
  hostConn.other = joinerConn;
  joinerConn.other = hostConn;

  const hostEvents = recorder();
  const joinerEvents = recorder();
  const host = new BridgeChannel(
    hostConn,
    "host",
    await importBridgeKey(hostSecret),
    hostEvents.callbacks,
  );
  const joiner = new BridgeChannel(
    joinerConn,
    "joiner",
    await importBridgeKey(joinerSecret),
    joinerEvents.callbacks,
  );
  openChannels.push(host, joiner);
  hostConn.openNow();
  joinerConn.openNow();
  return { host, joiner, hostConn, joinerConn, hostEvents, joinerEvents };
}

async function connected(): Promise<Session> {
  const session = await connect({});
  await until(
    () => session.host.isReady && session.joiner.isReady,
    "المصادقة الناجحة",
  );
  return session;
}

// ---------------------------------------------------------------------------
// المصادقة
// ---------------------------------------------------------------------------

test("handshake: matching secret authenticates both devices", async () => {
  const session = await connected();
  assert.equal(session.hostEvents.lastStatus(), "connected");
  assert.equal(session.joinerEvents.lastStatus(), "connected");
});

test("handshake: a wrong secret is denied on both sides", async () => {
  const session = await connect({
    hostSecret: generateBridgeSecret(),
    joinerSecret: generateBridgeSecret(),
  });
  await until(
    () => session.hostEvents.lastStatus() === "denied" &&
      session.joinerEvents.lastStatus() === "denied",
    "رفض الرمز الخاطئ",
  );
  assert.equal(session.host.isReady, false);
  assert.equal(session.joiner.isReady, false);
});

test("handshake: a signaling MITM that changes DTLS fingerprints is detected", async () => {
  // الوسيط يُظهر للضيف بصمة مختلفة (FP_ATTACKER) عن البصمة الفعلية للمضيف.
  const session = await connect({ joinerRemoteFingerprint: FP_ATTACKER });
  await until(
    () => session.hostEvents.lastStatus() !== undefined &&
      session.joinerEvents.lastStatus() !== undefined,
    "انتهاء المصادقة",
  );
  assert.equal(session.host.isReady, false);
  assert.equal(session.joiner.isReady, false);
  assert.notEqual(session.joinerEvents.lastStatus(), "connected");
});

test("handshake: missing DTLS fingerprints fail closed", async () => {
  // الضيف بلا بصمات في SDP: لا يجوز أن يكمل المصادقة أبداً.
  const hostConn = new FakeConnection(FP_HOST, FP_JOINER);
  const joinerConn = new FakeConnection(FP_JOINER, FP_HOST);
  joinerConn.peerConnection = null;
  hostConn.other = joinerConn;
  joinerConn.other = hostConn;
  const events = recorder();
  const channel = new BridgeChannel(
    joinerConn,
    "joiner",
    await importBridgeKey(generateBridgeSecret()),
    events.callbacks,
  );
  openChannels.push(channel);
  joinerConn.openNow();
  // طرف خام يرسل hello صالحاً شكلاً.
  hostConn.openNow();
  hostConn.send(
    JSON.stringify({ t: "hello", v: 1, n: base64UrlEncode(new Uint8Array(16).fill(7)) }),
  );
  await until(() => events.lastStatus() === "failed", "إغلاق بلا بصمات");
  assert.equal(channel.isReady, false);
});

// ---------------------------------------------------------------------------
// الشات والملفات
// ---------------------------------------------------------------------------

test("chat flows in both directions", async () => {
  const session = await connected();
  session.host.sendChat("  مرحباً من الكمبيوتر  ");
  session.joiner.sendChat("أهلاً من الهاتف");

  const inbound = (events: Recorder) => events.chats.filter((m) => m.direction === "in");
  await until(
    () => inbound(session.joinerEvents).length === 1 && inbound(session.hostEvents).length === 1,
    "وصول الرسائل",
  );
  assert.equal(inbound(session.joinerEvents)[0].text, "مرحباً من الكمبيوتر");
  assert.equal(inbound(session.hostEvents)[0].text, "أهلاً من الهاتف");
  // كل طرف يرى رسالته الصادرة في سجله أيضاً (بالاتجاه out).
  assert.equal(session.hostEvents.chats.filter((m) => m.direction === "out").length, 1);
  assert.equal(session.joinerEvents.chats.filter((m) => m.direction === "out").length, 1);
});

test("chat rejects empty and oversized text", async () => {
  const session = await connected();
  assert.throws(() => session.host.sendChat("   "));
  assert.throws(() => session.host.sendChat("x".repeat(BRIDGE_MAX_CHAT_CHARS + 1)));
  session.host.sendChat("x".repeat(BRIDGE_MAX_CHAT_CHARS));
});

test("files flow in both directions across many chunks, byte-exact", async () => {
  const session = await connected();
  const hostFile = randomBytes(700_000);
  const joinerFile = randomBytes(300_123);

  // إرسال متزامن من الطرفين يختبر أن الاتجاهين لا يتداخلان.
  session.host.sendFile({ name: "حاسوب.bin", mime: "application/octet-stream", bytes: hostFile });
  session.joiner.sendFile({ name: "هاتف.txt", mime: "text/plain", bytes: joinerFile });

  await until(
    () =>
      [...session.joinerEvents.files.values()].some((item) => item.status === "done") &&
      [...session.hostEvents.files.values()].some(
        (item) => item.direction === "in" && item.status === "done",
      ),
    "اكتمال الملفين",
    15_000,
  );

  const receivedOnJoiner = [...session.joinerEvents.files.values()].find(
    (item) => item.direction === "in",
  );
  const receivedOnHost = [...session.hostEvents.files.values()].find(
    (item) => item.direction === "in",
  );
  assert.equal(receivedOnJoiner?.name, "حاسوب.bin");
  assert.deepEqual(receivedOnJoiner?.bytes, hostFile);
  assert.equal(receivedOnHost?.name, "هاتف.txt");
  assert.deepEqual(receivedOnHost?.bytes, joinerFile);

  const sentStatuses = [...session.hostEvents.files.values()].filter(
    (item) => item.direction === "out",
  );
  assert.equal(sentStatuses[0]?.status, "done");
});

test("a corrupted chunk is caught by the end-to-end CRC and reported", async () => {
  const session = await connected();
  let flipped = false;
  session.hostConn.tamper = (data) => {
    if (data instanceof Uint8Array && !flipped) {
      flipped = true;
      const copy = new Uint8Array(data);
      copy[1000] ^= 0xff;
      return copy;
    }
    return data;
  };
  session.host.sendFile({
    name: "تالف.bin",
    mime: "application/octet-stream",
    bytes: randomBytes(90_000),
  });
  await until(
    () =>
      [...session.hostEvents.files.values()].some(
        (item) => item.direction === "out" && item.status === "failed",
      ) &&
      [...session.joinerEvents.files.values()].some(
        (item) => item.direction === "in" && item.status === "failed",
      ),
    "فشل التحقق من الملف التالف",
  );
  const outgoing = [...session.hostEvents.files.values()].find(
    (item) => item.direction === "out",
  );
  assert.match(outgoing?.error ?? "", /المجموع|التحقق/);
  const incoming = [...session.joinerEvents.files.values()].find(
    (item) => item.direction === "in",
  );
  assert.equal(incoming?.bytes, undefined);
  assert.equal(session.host.isReady, true, "فشل ملف واحد لا يقطع الجلسة");
});

test("a tampered file-end checksum is rejected without accepting the file", async () => {
  const session = await connected();
  session.hostConn.tamper = (data) => {
    if (typeof data === "string" && data.includes('"t":"file-end"')) {
      const parsed = JSON.parse(data) as { crc: number };
      parsed.crc = (parsed.crc + 1) >>> 0;
      return JSON.stringify(parsed);
    }
    return data;
  };
  session.host.sendFile({ name: "a.txt", mime: "text/plain", bytes: randomBytes(4096) });
  await until(
    () =>
      [...session.joinerEvents.files.values()].some(
        (item) => item.direction === "in" && item.status === "failed",
      ),
    "رفض المجموع الاختباري",
  );
  const incoming = [...session.joinerEvents.files.values()].find(
    (item) => item.direction === "in",
  );
  assert.equal(incoming?.bytes, undefined);
});

test("zero-byte files transfer successfully", async () => {
  const session = await connected();
  session.joiner.sendFile({ name: "فارغ.txt", mime: "", bytes: new Uint8Array(0) });
  await until(
    () =>
      [...session.hostEvents.files.values()].some(
        (item) => item.direction === "in" && item.status === "done",
      ),
    "استقبال ملف فارغ",
  );
  const item = [...session.hostEvents.files.values()].find(
    (entry) => entry.direction === "in",
  );
  assert.equal(item?.bytes?.length, 0);
  assert.equal(item?.mime, "application/octet-stream");
});

// ---------------------------------------------------------------------------
// الحماية من البروتوكول الخاطئ
// ---------------------------------------------------------------------------

test("messages before authentication are refused and close the channel", async () => {
  // مضيف حقيقي، وطرف خام يرسل شاتاً بدل المصادقة.
  const hostConn = new FakeConnection(FP_HOST, FP_JOINER);
  const rawConn = new FakeConnection(FP_JOINER, FP_HOST);
  hostConn.other = rawConn;
  rawConn.other = hostConn;
  const events = recorder();
  const channel = new BridgeChannel(
    hostConn,
    "host",
    await importBridgeKey(generateBridgeSecret()),
    events.callbacks,
  );
  openChannels.push(channel);
  hostConn.openNow();
  rawConn.openNow();
  await until(() => events.lastStatus() !== undefined, "انتظار hello", 3000);
  rawConn.send(JSON.stringify({ t: "chat", id: "abcdefgh", text: "تسلل" }));
  await until(() => events.lastStatus() === "failed", "رفض ما قبل المصادقة");
  assert.equal(events.chats.length, 0);
});

test("malformed control JSON closes an authenticated channel", async () => {
  const session = await connected();
  session.hostConn.send("{not json");
  await until(
    () => session.joinerEvents.lastStatus() === "failed",
    "إغلاق بعد JSON فاسد",
  );
  assert.equal(session.joiner.isClosed, true);
});

test("unknown control types and bogus file metadata are protocol violations", async () => {
  const session = await connected();
  session.hostConn.send(JSON.stringify({ t: "exec", cmd: "rm -rf" }));
  await until(() => session.joinerEvents.lastStatus() === "failed", "نوع غير معروف");

  const second = await connected();
  second.hostConn.send(
    JSON.stringify({ t: "file-start", id: "abcdefgh", name: "", mime: "x", size: 1 }),
  );
  await until(() => second.joinerEvents.lastStatus() === "failed", "اسم فارغ");
});

test("a chunk that exceeds the announced size closes the channel", async () => {
  const session = await connected();
  session.hostConn.send(
    JSON.stringify({ t: "file-start", id: "abcdefgh", name: "a", mime: "x", size: 4 }),
  );
  await until(
    () => session.joinerEvents.files.size === 1,
    "استلام الترويسة",
  );
  session.hostConn.send(new Uint8Array(10));
  await until(() => session.joinerEvents.lastStatus() === "failed", "تجاوز الحجم");
});

// ---------------------------------------------------------------------------
// وحدات مساعدة
// ---------------------------------------------------------------------------

test("incremental CRC-32 matches the optical protocol CRC-32 for any split", () => {
  const data = randomBytes(10_001);
  const expected = crc32(data);
  for (const split of [0, 1, 7, 4096, 10_000]) {
    let state = crc32Start();
    state = crc32Feed(state, data.subarray(0, split));
    state = crc32Feed(state, data.subarray(split));
    assert.equal(crc32Finish(state), expected, `split=${split}`);
  }
});

test("DTLS fingerprints are parsed from SDP and rejected when absent", () => {
  assert.equal(dtlsFingerprintsFromSdp(sdpFor(FP_HOST)), FP_HOST);
  const multi = `${sdpFor(FP_JOINER)}${sdpFor(FP_HOST)}`;
  assert.equal(dtlsFingerprintsFromSdp(multi), [FP_HOST, FP_JOINER].sort().join(";"));
  assert.equal(dtlsFingerprintsFromSdp("v=0\r\n"), null);
  assert.equal(dtlsFingerprintsFromSdp(null), null);
  assert.equal(dtlsFingerprintsFromSdp("a=fingerprint:sha-1 " + FP_HOST), null);
});

test("proofs are bound to role and transcript", async () => {
  const key = await importBridgeKey(generateBridgeSecret());
  const transcript = bridgeTranscript({
    hostFingerprint: FP_HOST,
    joinerFingerprint: FP_JOINER,
    hostNonce: base64UrlEncode(new Uint8Array(16).fill(1)),
    joinerNonce: base64UrlEncode(new Uint8Array(16).fill(2)),
  });
  const proof = await computeBridgeProof(key, "joiner", transcript);
  assert.equal(await verifyBridgeProof(key, "joiner", transcript, proof), true);
  // دور معكوس لا يصح (لا يمكن إعادة استخدام بروفة الضيف كبروفة مضيف).
  assert.equal(await verifyBridgeProof(key, "host", transcript, proof), false);
  const otherTranscript = bridgeTranscript({
    hostFingerprint: FP_ATTACKER,
    joinerFingerprint: FP_JOINER,
    hostNonce: base64UrlEncode(new Uint8Array(16).fill(1)),
    joinerNonce: base64UrlEncode(new Uint8Array(16).fill(2)),
  });
  assert.equal(await verifyBridgeProof(key, "joiner", otherTranscript, proof), false);
  assert.equal(await verifyBridgeProof(key, "joiner", transcript, "x".repeat(43)), false);
  assert.equal(await verifyBridgeProof(key, "joiner", transcript, 123), false);
});

const SAMPLE: BridgePairing = {
  peerId: "peer-ABC_123",
  secret: "AAAAAAAAAAAAAAAAAAAAAA",
  server: { host: "0.peerjs.com", port: 443, path: "/", secure: true },
};

test("pairing payload round-trips and carries the signaling server", () => {
  const payload = encodeBridgePairing(SAMPLE);
  assert.ok(payload.startsWith(BRIDGE_PREFIX));
  assert.deepEqual(decodeBridgePairing(payload), SAMPLE);
  // الرابط الكامل الذي يُعرض في QR يُفكّ بالطريقة نفسها.
  const url = bridgeShareUrl("https://qrferry.example/", payload);
  assert.equal(url, `https://qrferry.example/pc#${payload}`);
  assert.deepEqual(decodeBridgePairing(url), SAMPLE);
  assert.deepEqual(decodeBridgePairing(`  ${payload}\n`), SAMPLE);
});

test("pairing decoder rejects malformed or hostile input", () => {
  const good = encodeBridgePairing(SAMPLE);
  assert.equal(decodeBridgePairing(""), null);
  assert.equal(decodeBridgePairing("QFTV:abc:123456"), null);
  assert.equal(decodeBridgePairing(`xx${good}`), null, "no boundary before prefix");
  assert.equal(decodeBridgePairing(good.slice(0, -4)), null, "truncated payload");
  assert.equal(decodeBridgePairing(`${good}!`), null, "trailing junk");

  const withWire = (wire: Record<string, unknown>) =>
    `${BRIDGE_PREFIX}${base64UrlEncode(new TextEncoder().encode(JSON.stringify(wire)))}`;
  const base = { v: 1, p: "peer1", s: SAMPLE.secret, h: "example.com", o: 443, r: "/", t: 1 };
  assert.ok(decodeBridgePairing(withWire(base)));
  assert.equal(decodeBridgePairing(withWire({ ...base, v: 2 })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, s: "short" })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, h: "evil host" })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, o: 70000 })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, o: 1.5 })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, r: "//evil" })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, t: 2 })), null);
  assert.equal(decodeBridgePairing(withWire({ ...base, p: "../x" })), null);
  assert.equal(decodeBridgePairing(withWire(["not", "object"] as unknown as Record<string, unknown>)), null);
});

test("encodeBridgePairing refuses invalid pairings", () => {
  assert.throws(() => encodeBridgePairing({ ...SAMPLE, secret: "bad" }));
  assert.throws(() =>
    encodeBridgePairing({ ...SAMPLE, server: { ...SAMPLE.server, port: 0 } }),
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePairing,
  encodePairing,
  makePasscode,
  PAIRING_PREFIX,
  DEFAULT_PEER_SERVER,
  getPeerServerConfig,
  setPeerServerConfig,
} from "../lib/fast-transfer";

test("pairing payload round-trips", () => {
  const info = { peerId: "qrferry-abc123", passcode: "482913" };
  const payload = encodePairing(info);
  assert.ok(payload.startsWith(PAIRING_PREFIX));
  const decoded = decodePairing(payload);
  assert.deepEqual(decoded, info);
});

test("decodePairing rejects invalid payloads", () => {
  assert.equal(decodePairing("garbage"), null);
  assert.equal(decodePairing(""), null);
  assert.equal(decodePairing(`${PAIRING_PREFIX}:`), null);
  assert.equal(decodePairing(`${PAIRING_PREFIX}peeronly:`), null);
  assert.equal(decodePairing(`${PAIRING_PREFIX}:123456`), null);
  // معرف يحتوي على نقطتين عاديتين (لا ':') — نتحقق من استخراج آخر جزء كرمز
  const withDots = decodePairing(`${PAIRING_PREFIX}peer.a.b:123456`);
  assert.deepEqual(withDots, { peerId: "peer.a.b", passcode: "123456" });
});

test("makePasscode produces 6 digits by default", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = makePasscode();
    assert.match(code, /^\d{6}$/);
  }
  assert.match(makePasscode(8), /^\d{8}$/);
});

test("peer server config defaults to the public cloud", () => {
  // في بيئة Node لا يوجد localStorage → القيمة الافتراضية
  const config = getPeerServerConfig();
  assert.equal(config.host, DEFAULT_PEER_SERVER.host);
  assert.equal(config.secure, true);
});

test("peer server config respects saved overrides when localStorage exists", () => {
  const localStorageValues = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
  };
  // نحقن fake localStorage مؤقتاً
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;

  try {
    setPeerServerConfig({ host: "192.168.1.5", port: 9000, path: "/", secure: false });
    const config = getPeerServerConfig();
    assert.equal(config.host, "192.168.1.5");
    assert.equal(config.port, 9000);
    assert.equal(config.secure, false);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  }
});

test("idle guard: continuous activity prevents firing regardless of duration", async () => {
  const { createIdleGuard } = await import("../lib/fast-transfer");
  let fired = false;
  const guard = createIdleGuard(() => { fired = true; }, 80, 20);
  try {
    // نشاط مستمر كل 20ms لمدة ~500ms (أطول بكثير من مهلة 80ms)
    const started = Date.now();
    while (Date.now() - started < 500) {
      guard.ping();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    guard.stop();
  }
  assert.equal(fired, false, "النشاط المستمر يجب أن يمنع إطلاق الحارس مهما طال");
});

test("idle guard: real inactivity fires after the timeout", async () => {
  const { createIdleGuard } = await import("../lib/fast-transfer");
  let fired = false;
  const guard = createIdleGuard(() => { fired = true; }, 80, 20);
  // خمول حقيقي: لا ping لمدة 120ms > مهلة 80ms
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(fired, true, "الخمول الحقيقي يجب أن يُطلق الحارس");
  guard.stop();
});

test("idle guard: stop prevents firing afterwards", async () => {
  const { createIdleGuard } = await import("../lib/fast-transfer");
  let fired = false;
  const guard = createIdleGuard(() => { fired = true; }, 60, 20);
  guard.stop();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(fired, false, "إيقاف الحارس يجب أن يمنع الإطلاق");
});

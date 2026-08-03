import assert from "node:assert/strict";
import test from "node:test";
import {
  isStableFromRate,
  StabilityTracker,
} from "../lib/stability";
import {
  notifyTransferComplete,
  playCompletionSound,
  vibrateCompletion,
  ensureNotificationPermission,
  showCompletionNotification,
} from "../lib/transfer-notify";
import { acquireScreenWakeLock } from "../lib/wakelock";

test("StabilityTracker stays unstable below minimum attempts", () => {
  const tracker = new StabilityTracker();
  tracker.push(true);
  tracker.push(true);
  tracker.push(true);
  tracker.push(true);
  tracker.push(true);
  assert.equal(tracker.state.stable, false); // أقل من MIN_ATTEMPTS = 6
  assert.equal(tracker.state.successRate, 1);
  assert.equal(tracker.state.attempts, 5);
});

test("StabilityTracker becomes stable at high success rate", () => {
  const tracker = new StabilityTracker();
  for (let index = 0; index < 12; index += 1) tracker.push(true);
  const state = tracker.state;
  assert.equal(state.stable, true);
  assert.equal(state.successRate, 1);
});

test("StabilityTracker stays unstable when failures dominate", () => {
  const tracker = new StabilityTracker();
  // 8 فشل + 2 نجاح → نسبة 20%
  for (let index = 0; index < 8; index += 1) tracker.push(false);
  for (let index = 0; index < 2; index += 1) tracker.push(true);
  const state = tracker.state;
  assert.equal(state.stable, false);
  assert.ok(state.successRate < 0.85);
});

test("StabilityTracker rolls over window (old samples forgotten)", () => {
  const tracker = new StabilityTracker();
  // نافذة 14: نملأها فشل ثم نجاحات متتالية — نحتاج 12 نجاحاً من 14 لتصبح مستقرة
  for (let index = 0; index < 14; index += 1) tracker.push(false);
  for (let index = 0; index < 12; index += 1) tracker.push(true);
  const state = tracker.state;
  assert.equal(state.attempts, 14);
  assert.equal(state.stable, true); // 12/14 = 85.7% ≥ 0.85
});

test("isStableFromRate helper matches threshold", () => {
  assert.equal(isStableFromRate(5, 6), false); // 83%
  assert.equal(isStableFromRate(6, 6), true);
  assert.equal(isStableFromRate(9, 10), true);
  assert.equal(isStableFromRate(2, 10), false);
  assert.equal(isStableFromRate(0, 5), false); // أقل من الحد الأدنى
});

test("wakelock returns a safe no-op release even without browser support", async () => {
  // في بيئة Node لا يوجد navigator.wakeLock → يرجع دالة release آمنة
  const release = await acquireScreenWakeLock();
  assert.equal(typeof release, "function");
  await release(); // يجب ألا يرمي
});

test("notification helpers never throw in non-browser environment", () => {
  assert.doesNotThrow(() => vibrateCompletion());
  assert.doesNotThrow(() => playCompletionSound());
  assert.doesNotThrow(() => showCompletionNotification("t", "b"));
  assert.doesNotThrow(() => notifyTransferComplete("file.bin"));
  void ensureNotificationPermission;
});

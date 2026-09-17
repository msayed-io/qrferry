import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserOperationTimeout,
  describeBrowserError,
  withDeadline,
} from "../lib/browser-operation";

test("empty browser error messages preserve the actual exception name", () => {
  assert.equal(
    describeBrowserError(new DOMException("", "QuotaExceededError")),
    "QuotaExceededError",
  );
  assert.equal(
    describeBrowserError(new Error("disk unavailable")),
    "disk unavailable",
  );
  assert.equal(
    describeBrowserError(new DOMException("denied", "NotAllowedError")),
    "denied (NotAllowedError)",
  );
  assert.equal(
    describeBrowserError({ name: "QuotaExceededError", message: "" }),
    "QuotaExceededError",
  );
  assert.equal(describeBrowserError(undefined), "UnknownError");
});
test("a missing completion signal rejects once at the deadline and performs cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cleanup = 0;
  const pending = withDeadline(
    new Promise<void>(() => {}),
    "library-write",
    30_000,
    () => {
      cleanup++;
    },
  );
  const checked = assert.rejects(
    pending,
    (e) => e instanceof BrowserOperationTimeout && e.phase === "library-write",
  );
  t.mock.timers.tick(30_000);
  await checked;
  assert.equal(cleanup, 1);
  t.mock.timers.tick(30_000);
  assert.equal(cleanup, 1);
});
test("completion before deadline clears the watchdog", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  assert.equal(
    await withDeadline(Promise.resolve(7), "library-open", 100, () => {
      cancelled = true;
    }),
    7,
  );
  t.mock.timers.tick(100);
  assert.equal(cancelled, false);
});
test("original failures are preserved rather than replaced by timeout", async () => {
  const cause = new DOMException("", "QuotaExceededError");
  await assert.rejects(
    withDeadline(Promise.reject(cause), "library-write", 50),
    (e) => e === cause,
  );
});
test("late completion cannot turn a timeout into success; cleanup exceptions are isolated", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: number) => void;
  const promise = withDeadline(
    new Promise<number>((resolve) => {
      finish = resolve;
    }),
    "library-write",
    100,
    () => {
      throw new Error("already committed");
    },
  );
  const checked = assert.rejects(promise, BrowserOperationTimeout);
  t.mock.timers.tick(100);
  await checked;
  finish(1);
  await Promise.resolve();
  await assert.rejects(promise, BrowserOperationTimeout);
});

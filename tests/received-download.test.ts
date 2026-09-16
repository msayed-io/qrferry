import assert from "node:assert/strict";
import test from "node:test";
import { ReceivedDownloads } from "../lib/save-received-file";

test("direct downloads use exact bytes and clean up URLs on timeout, disposal, unsupported and failure paths", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  let supported = true,
    fail = false,
    clicked = 0,
    removed = 0;
  const blobs: Blob[] = [],
    revoked: string[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: { appendChild() {} },
      createElement() {
        return {
          ...(supported ? { download: "" } : {}),
          href: "",
          click() {
            if (fail) throw new Error("blocked");
            clicked++;
          },
          remove() {
            removed++;
          },
        };
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });
  t.mock.method(URL, "createObjectURL", (blob: Blob) => {
    blobs.push(blob);
    return `blob:test-${blobs.length}`;
  });
  t.mock.method(URL, "revokeObjectURL", (url: string) => {
    revoked.push(url);
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = new ReceivedDownloads();
  t.after(() => queue.dispose());
  const source = new Uint8Array([9, 1, 2, 8]);
  const file = {
    name: "test.wav",
    mime: "audio/wav",
    bytes: source.subarray(1, 3),
  };
  assert.equal(queue.request(file), "requested");
  assert.deepEqual(
    Array.from(new Uint8Array(await blobs[0].arrayBuffer())),
    [1, 2],
  );
  assert.equal(blobs[0].type, "audio/wav");
  assert.equal(clicked, 1);
  assert.equal(removed, 1);
  t.mock.timers.tick(59_999);
  assert.deepEqual(revoked, []);
  t.mock.timers.tick(1);
  assert.deepEqual(revoked, ["blob:test-1"]);
  queue.request(file);
  queue.dispose();
  assert.deepEqual(revoked, ["blob:test-1", "blob:test-2"]);
  supported = false;
  assert.equal(queue.request(file), "unsupported");
  supported = true;
  fail = true;
  assert.throws(() => queue.request(file), /blocked/);
  assert.equal(removed, 3);
  assert.equal(revoked.length, 4);
  t.mock.timers.tick(60_000);
  assert.equal(revoked.length, 4);
});

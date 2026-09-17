import assert from "node:assert/strict";
import test from "node:test";
import {
  FileSelectionError,
  MAX_BATCH_FILES,
  planFileSelection,
} from "../lib/file-selection";
const file = (name: string, size = 10) => ({ name, size });

test("batch accepts one, two and three files without changing order or identity", () => {
  const files = [file("a"), file("b"), file("c")];
  assert.equal(MAX_BATCH_FILES, 3);
  for (let n = 1; n <= 3; n++) {
    const selection = planFileSelection([], files.slice(0, n), false, 30);
    assert.deepEqual(selection, files.slice(0, n));
    assert.equal(selection[0], files[0]);
  }
});
test("adding files retains existing references and replacement does not append", () => {
  const a = file("a"),
    b = file("b"),
    c = file("c");
  const original = [a];
  assert.deepEqual(planFileSelection(original, [b, c], true, 30), [a, b, c]);
  assert.deepEqual(original, [a]);
  assert.deepEqual(planFileSelection(original, [b], false, 30), [b]);
});
test("four-file selections reject atomically, both on initial choice and append", () => {
  const files = [file("a"), file("b"), file("c"), file("d")];
  for (const append of [false, true]) {
    const current = append ? files.slice(0, 2) : [];
    const incoming = append ? files.slice(2) : files;
    assert.throws(
      () => planFileSelection(current, incoming, append, 100),
      (e) => e instanceof FileSelectionError && e.reason === "count",
    );
    assert.equal(current.length, append ? 2 : 0);
  }
});
test("total size is enforced including previously selected files, with inclusive boundary", () => {
  const a = file("a", 20),
    b = file("b", 11);
  assert.throws(
    () => planFileSelection([a], [b], true, 30),
    (e) => e instanceof FileSelectionError && e.reason === "size",
  );
  assert.equal(planFileSelection([a], [b], true, 31).length, 2);
});
test("empty replacement clears the batch; zero-byte files and same names are retained", () => {
  assert.deepEqual(planFileSelection([file("a")], [], false, 30), []);
  const distinct = [file("same", 0), file("same", 0)];
  assert.deepEqual(planFileSelection([], distinct, false, 0), distinct);
});

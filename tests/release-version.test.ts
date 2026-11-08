import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(
  new URL("../scripts/bump-android-version.mjs", import.meta.url),
);
for (const [version, previous, next] of [
  ["1.2.9", 10208, 10209],
  ["1.2.100", 10299, 10300],
  ["1.3.0", 10300, 10301],
] as const) {
  test(`Android code is monotonic for ${version}, including patch 100`, async () => {
    const root = await mkdtemp(join(tmpdir(), "qrferry-version-"));
    try {
      await mkdir(join(root, "android/app"), { recursive: true });
      await writeFile(join(root, "package.json"), JSON.stringify({ version }));
      await writeFile(
        join(root, "android/app/build.gradle"),
        `versionCode ${previous}\nversionName "1.2.8"\n`,
      );
      const { stdout } = await promisify(execFile)(process.execPath, [script], {
        cwd: root,
      });
      assert.equal(JSON.parse(stdout).versionCode, next);
      assert.match(
        await readFile(join(root, "android/app/build.gradle"), "utf8"),
        new RegExp(`versionCode ${next}`),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

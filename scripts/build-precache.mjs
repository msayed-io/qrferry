import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : path.join(directory, entry.name),
      ),
    )
  ).flat();
}
const assets = (await files("dist"))
  .filter(
    (file) => !["sw.js", "asset-manifest.json"].includes(path.basename(file)),
  )
  .sort();
const template = await readFile("public/sw.js", "utf8");
const hash = createHash("sha256").update(template);
for (const file of assets) {
  hash.update(file);
  hash.update(await readFile(file));
}
const version = hash.digest("hex").slice(0, 16);
const urls = assets.map(
  (file) => "/" + path.relative("dist", file).replaceAll(path.sep, "/"),
);
await writeFile("dist/asset-manifest.json", JSON.stringify(urls));
await writeFile(
  "dist/sw.js",
  template
    .replace("__BUILD_ID__", version)
    .replace("/*__PRECACHE__*/[]", JSON.stringify(urls)),
);
console.log(
  `Offline cache ${version}: ${urls.length} complete build assets, including lazy chunks and WASM.`,
);

// Narrow, version-checked patch to upstream Glisse 0.5.0 (MIT). No spring,
// lens map, refraction graph or input/selection implementation is replaced.
// The opt-in physical rim replaces native rim rasterization, never the lens.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../node_modules/glisse/', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (pkg.version !== '0.5.0') throw new Error('Review Glisse performance patch before changing its version.');
const marker = '// QRFerry: coalesce segment paints within the same animation frame.';
const changes = [
 ['const backdrop = bendsBackdrop && refractsBackdrop() ? createBackdropLens(lens, options) : null;', 'const backdrop = bendsBackdrop && refractsBackdrop() && getComputedStyle(lens).getPropertyValue("--qf-live-backdrop").trim() !== "off" ? createBackdropLens(lens, options) : null;'],
 ['const paint = () => {\n\t\tconst { x, lift } = state;', 'const paintNow = () => {\n\t\tconst { x, lift } = state;'],
 ['\tconst x = createSpring(0, REST[0], REST[1], (value) => {', `${marker}
\tlet paintPending = false, disposed = false;
\tconst paint = () => {
\t\tif (paintPending || disposed) return;
\t\tpaintPending = true;
\t\tqueueMicrotask(() => { paintPending = false; if (!disposed) paintNow(); });
\t};
\tconst x = createSpring(0, REST[0], REST[1], (value) => {`],
 ['\t\t\tx.stop();\n\t\t\tlift.stop();', '\t\t\tdisposed = true;\n\t\t\tx.stop();\n\t\t\tlift.stop();'],
 ['fitSelection(element, bendsBackdrop && refractsBackdrop())', 'fitSelection(element, bendsBackdrop && refractsBackdrop() && getComputedStyle(element).getPropertyValue("--qf-live-backdrop").trim() !== "off")'],
 ['if (refractsBackdrop()) fitBackdropLens(element, GLASS);', 'if (refractsBackdrop() && getComputedStyle(element).getPropertyValue("--qf-live-backdrop").trim() !== "off") fitBackdropLens(element, GLASS);'],
];
const marker2 = '// QRFerry: retain unchanged mask properties and read geometry before filter writes.';
const changes2 = [
 ['function mask(element, layers) {\n\tfor (const part of MASKING) {', `${marker2}
const maskValues = new WeakMap();
function mask(element, layers) {
 if (!layers) {
  maskValues.delete(element);
  for (const part of MASKING) {
   element.style.removeProperty(\`-webkit-mask-\${part}\`);
   element.style.removeProperty(\`mask-\${part}\`);
  }
  return;
 }
 const previous = maskValues.get(element) || {};
 const values = { ...layers, repeat: "no-repeat", composite: "exclude" };
 for (const part of MASKING) {
  if (previous[part] === values[part]) continue;
  element.style.setProperty(\`-webkit-mask-\${part}\`, part === "composite" ? "xor" : values[part]);
  element.style.setProperty(\`mask-\${part}\`, values[part]);
 }
 maskValues.set(element, values);
}
function unusedOriginalMask(element, layers) {
\tfor (const part of MASKING) {`],
 ['const at = member.glass.getBoundingClientRect();', 'const at = member.glass.getBoundingClientRect();\n\t\t\tmember.behind = member.replaces?.getBoundingClientRect();'],
 ['const behind = member.replaces.getBoundingClientRect();', 'const behind = member.behind;'],
];
// Validate both artifacts before writing either, and fail closed on upstream drift.
const rimMarker = '// QRFerry: physical rim owns this edge; do not raster a second native rim.';
const rimChanges = [
 ['function paintRim(element) {\n\tconst style = getComputedStyle(element);', `function paintRim(element) {
 ${rimMarker}
 const style = getComputedStyle(element);
 if (style.getPropertyValue("--qf-specular-rim").trim() === "physical") return;`],
 ['function fitSelection(element, filtered) {', `function fitSelection(element, filtered) {
 if (!filtered && getComputedStyle(element).getPropertyValue("--qf-specular-rim").trim() === "physical") return;`],
];
const results = [];
for (const name of ['dist/index.js', 'dist/index.cjs']) {
 let source = await readFile(new URL(name, root), 'utf8');
 if (source.includes(rimMarker)) continue;
 const pending = [...(source.includes(marker2) ? [] : source.includes(marker) ? changes2 : [...changes, ...changes2]), ...rimChanges];
 for (const [before, after] of pending) {
  if (source.split(before).length !== 2) throw new Error(`Glisse patch mismatch: ${name}: ${before}`);
  source = source.replace(before, after);
 }
 source = source.replace(/function unusedOriginalMask\(element, layers\) \{[\s\S]*?\n\}(?=\n\/\*\*)/, "");
 results.push([name, source]);
}
for (const [name, source] of results) await writeFile(new URL(name, root), source);
console.log('Glisse 0.5.0: same-frame segment paint batching; unused backdrop opt-out; single physical rim owner.');

await import("./patch-glisse-tap.mjs");

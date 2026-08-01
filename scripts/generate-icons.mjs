/**
 * يولّد أيقونات PWA (192/512/maskable) من مصدر SVG واحد.
 * التشغيل: node scripts/generate-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "scripts", "icon-source.svg"));
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const SIZES = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

for (const { name, size } of SIZES) {
  const buffer = await sharp(source).resize(size, size).png().toBuffer();
  writeFileSync(join(outDir, name), buffer);
  console.log(`✓ ${name} (${size}×${size})`);
}

// أيقونة maskable: الخلفية ممتلئة حتى الحواف (بدون زوايا دائرية) لأن
// النظام قد يقصّها في أشكال مختلفة، ويُحفظ الشعار داخل منطقة الأمان 80%.
const maskable = await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#111820" },
})
  .composite([
    {
      input: await sharp(source).resize(410, 410).png().toBuffer(),
      gravity: "center",
    },
  ])
  .png()
  .toBuffer();
writeFileSync(join(outDir, "maskable-512.png"), maskable);
console.log("✓ maskable-512.png (512×512)");

console.log("تم توليد جميع الأيقونات.");

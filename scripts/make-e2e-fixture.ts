/**
 * يولّد ملف بيانات ثابت (JSON) لاختبارات E2E باستخدام نفس مكتبات الإنتاج.
 *
 * يُشغَّل عبر tsx (الذي يترجم حزم TypeScript مثل @raptorqr/core):
 *   node --import tsx scripts/make-e2e-fixture.ts
 *
 * الناتج: .e2e/fixtures.json — بيانات خام يقرؤها Playwright بلا أي استيراد
 * من node_modules، فيتجنب قيد مترجم Playwright مع ملفات TS الخارجية.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPackageTransferFixture,
  buildTransferFixture,
  makeCompressibleBytes,
} from "../e2e/helpers/transfer-fixture";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".e2e");
mkdirSync(outDir, { recursive: true });

type SerializedFrame = { n: number; dataB64: string };

function serializeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function serializeFrames(
  frames: Array<{ n: number; data: Uint8Array }>,
): SerializedFrame[] {
  return frames.map((frame) => ({
    n: frame.n,
    dataB64: serializeBytes(frame.data),
  }));
}

async function buildSerialized(options: {
  bytes: Uint8Array;
  password?: string;
}) {
  const fixture = await buildTransferFixture(options);
  return {
    kind: "plain",
    frames: serializeFrames(fixture.frames),
    originalBytesB64: serializeBytes(fixture.originalBytes),
    packetCount: fixture.packetCount,
    symbolSize: fixture.symbolSize,
    encrypted: fixture.encrypted,
  };
}

async function buildPackageSerialized(options: {
  fileSpecs: Array<{ name: string; mime: string; bytes: Uint8Array }>;
  burn?: boolean;
  signed?: boolean;
  signerName?: string;
}) {
  const fixture = await buildPackageTransferFixture(options);
  return {
    kind: "package",
    frames: serializeFrames(fixture.frames),
    files: fixture.originalFiles.map((file) => ({
      name: file.name,
      mime: file.mime,
      bytesB64: serializeBytes(file.bytes),
    })),
    burn: Boolean(options.burn),
    signed: Boolean(options.signed),
  };
}

const output = {
  plain: await buildSerialized({ bytes: makeCompressibleBytes(400_000) }),
  encrypted: await buildSerialized({
    bytes: makeCompressibleBytes(250_000),
    password: "secret-pass",
  }),
  multiPackage: await buildPackageSerialized({
    fileSpecs: [
      { name: "تقرير.txt", mime: "text/plain", bytes: makeCompressibleBytes(9000) },
      { name: "بيانات.csv", mime: "text/csv", bytes: makeCompressibleBytes(6000) },
    ],
  }),
  signedPackage: await buildPackageSerialized({
    fileSpecs: [
      { name: "عقد-موقّع.txt", mime: "text/plain", bytes: makeCompressibleBytes(8000) },
    ],
    signed: true,
    signerName: "قسم الأمن",
  }),
  burnPackage: await buildPackageSerialized({
    fileSpecs: [
      { name: "سري-جدا.txt", mime: "text/plain", bytes: makeCompressibleBytes(7000) },
    ],
    burn: true,
  }),
  historyPackage: await buildPackageSerialized({
    fileSpecs: [
      { name: "للتاريخ.txt", mime: "text/plain", bytes: makeCompressibleBytes(5000) },
    ],
  }),
};

const target = join(outDir, "fixtures.json");
writeFileSync(target, `${JSON.stringify(output)}\n`, "utf8");
console.log(`✓ وُلّدت بيانات E2E: ${target}`);
console.log(
  `  plain: ${output.plain.frames.length} إطاراً · encrypted: ${output.encrypted.frames.length} · multi: ${output.multiPackage.frames.length} · signed: ${output.signedPackage.frames.length} · burn: ${output.burnPackage.frames.length}`,
);
